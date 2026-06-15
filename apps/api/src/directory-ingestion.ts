import type { PoolClient } from "pg";
import { transaction, upsertPrincipal } from "./graph-repository.js";
import type { GraphClient } from "./microsoft-graph-client.js";

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string };
type DirectoryUser = {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  userType?: string;
  jobTitle?: string;
};
type DirectoryGroup = {
  id: string;
  displayName?: string;
  mail?: string;
  description?: string;
  groupTypes?: string[];
  securityEnabled?: boolean;
};
type DirectoryMember = { id?: string };

async function all<T>(graph: GraphClient, path: string) {
  const values: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: GraphPage<T> = await graph.request("GET", next);
    values.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return values;
}

function groupType(group: DirectoryGroup): "domain" | "m365" | "security" {
  if (group.groupTypes?.includes("Unified")) return "m365";
  if (group.securityEnabled) return "security";
  return "domain";
}

async function replaceMemberships(
  client: PoolClient,
  graph: GraphClient,
  tenantId: string,
  groups: DirectoryGroup[],
  principalIds: Map<string, string>,
) {
  await client.query(
    `DELETE FROM principal_memberships
     WHERE tenant_id = $1 AND parent_principal_id IN
       (SELECT id FROM principals WHERE tenant_id = $1 AND principal_type = 'group')`,
    [tenantId],
  );
  let memberships = 0;
  let failedGroups = 0;
  for (const group of groups) {
    const parentId = principalIds.get(group.id);
    if (!parentId) continue;
    try {
      const members = await all<DirectoryMember>(
        graph,
        `/groups/${group.id}/transitiveMembers?$select=id&$top=999`,
      );
      for (const member of members) {
        const childId = member.id ? principalIds.get(member.id) : undefined;
        if (!childId || childId === parentId) continue;
        const result = await client.query(
          `INSERT INTO principal_memberships
            (tenant_id, parent_principal_id, child_principal_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [tenantId, parentId, childId],
        );
        memberships += result.rowCount ?? 0;
      }
    } catch {
      failedGroups += 1;
    }
  }
  return { memberships, failedGroups };
}

export async function ingestTenantDirectory(graph: GraphClient, tenantId: string) {
  const [users, groups] = await Promise.all([
    all<DirectoryUser>(
      graph,
      "/users?$select=id,displayName,mail,userPrincipalName,userType,jobTitle&$top=999",
    ),
    all<DirectoryGroup>(
      graph,
      "/groups?$select=id,displayName,mail,description,groupTypes,securityEnabled&$top=999",
    ),
  ]);

  return transaction(async (client) => {
    await client.query(
      "UPDATE principals SET is_active = false, updated_at = now() WHERE tenant_id = $1 AND principal_type IN ('user', 'guest', 'group')",
      [tenantId],
    );
    const principalIds = new Map<string, string>();
    for (const user of users) {
      const id = await upsertPrincipal(client, {
        tenantId,
        principalType: user.userType?.toLowerCase() === "guest" ? "guest" : "user",
        displayName: user.displayName ?? user.mail ?? user.userPrincipalName ?? user.id,
        email: user.mail ?? user.userPrincipalName ?? null,
        jobTitle: user.jobTitle ?? null,
        externalId: user.id,
      });
      principalIds.set(user.id, id);
    }
    for (const group of groups) {
      const id = await upsertPrincipal(client, {
        tenantId,
        principalType: "group",
        displayName: group.displayName ?? group.mail ?? group.id,
        email: group.mail ?? null,
        description: group.description ?? null,
        groupType: groupType(group),
        externalId: group.id,
      });
      principalIds.set(group.id, id);
    }
    const membershipResult = await replaceMemberships(client, graph, tenantId, groups, principalIds);
    await client.query("SELECT refresh_effective_access($1)", [tenantId]);
    return {
      users: users.filter((user) => user.userType?.toLowerCase() !== "guest").length,
      guests: users.filter((user) => user.userType?.toLowerCase() === "guest").length,
      groups: groups.length,
      ...membershipResult,
    };
  });
}

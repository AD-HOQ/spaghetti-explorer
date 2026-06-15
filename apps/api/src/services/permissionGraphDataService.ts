import type { Pool } from "pg";
import type { PermissionGraphData, PermissionPrincipal } from "../types/permissions.js";

function principalType(row: { principalType: string; displayName: string; groupType: string | null }): PermissionPrincipal["principalType"] {
  const name = row.displayName.toLowerCase();
  if (name.includes("everyone except external")) return "EveryoneExceptExternalUsers";
  if (name === "everyone" || name === "all employees") return "Everyone";
  if (row.principalType === "group") return "Group";
  return "User";
}

export async function loadProductionPermissionGraph(pool: Pool, tenantId: string): Promise<PermissionGraphData> {
  const [resources, principals, grants] = await Promise.all([
    pool.query<{
      id: string; nodeId: string; resourceType: "site" | "library" | "folder" | "document"; name: string; path: string | null;
      parentId: string | null; createdDate: string; lastModifiedDate: string; ownerIds: string[];
    }>(
      `SELECT n.id, n.id AS "nodeId", n.node_type AS "resourceType", n.name, n.path, n.parent_id AS "parentId",
        n.created_at AS "createdDate", n.updated_at AS "lastModifiedDate",
        COALESCE(array_agg(DISTINCT p.principal_id) FILTER (WHERE p.permission_type = 'owner' AND p.effect = 'allow'), ARRAY[]::uuid[])::text[] AS "ownerIds"
       FROM document_nodes n
       LEFT JOIN permissions p ON p.node_id = n.id AND p.tenant_id = n.tenant_id
       WHERE n.tenant_id = $1
       GROUP BY n.id`,
      [tenantId],
    ),
    pool.query<{
      id: string; displayName: string; principalType: string; groupType: string | null; email: string | null; isActive: boolean; memberCount: number;
    }>(
      `SELECT p.id, p.display_name AS "displayName", p.principal_type AS "principalType", p.group_type AS "groupType",
        p.email, p.is_active AS "isActive", count(pm.child_principal_id)::int AS "memberCount"
       FROM principals p
       LEFT JOIN principal_memberships pm ON pm.parent_principal_id = p.id AND pm.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
       GROUP BY p.id`,
      [tenantId],
    ),
    pool.query<{
      id: string; resourceId: string; principalId: string; permissionType: string; inherit: boolean; permissionSource: string | null; createdDate: string;
    }>(
      `SELECT id, node_id AS "resourceId", principal_id AS "principalId", permission_type AS "permissionType",
        inherit, permission_source AS "permissionSource", created_at AS "createdDate"
       FROM permissions WHERE tenant_id = $1 AND effect = 'allow'`,
      [tenantId],
    ),
  ]);

  const mappedPrincipals = principals.rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    principalType: principalType(row),
    email: row.email ?? undefined,
    isExternal: row.principalType === "guest",
    isActive: row.isActive,
    memberCount: row.memberCount,
  }));
  const mappedPrincipalById = new Map(mappedPrincipals.map((principal) => [principal.id, principal]));

  return {
    resources: resources.rows.map((resource) => ({
      id: resource.id,
      nodeId: resource.nodeId,
      resourceType: resource.resourceType === "document" ? "File" : `${resource.resourceType[0].toUpperCase()}${resource.resourceType.slice(1)}` as "Site" | "Library" | "Folder",
      name: resource.name,
      path: resource.path ?? resource.name,
      parentId: resource.parentId ?? undefined,
      createdDate: new Date(resource.createdDate).toISOString(),
      lastModifiedDate: new Date(resource.lastModifiedDate).toISOString(),
      ownerIds: resource.ownerIds,
    })),
    principals: mappedPrincipals,
    grants: grants.rows.map((grant) => {
      const principal = mappedPrincipalById.get(grant.principalId);
      return {
        id: grant.id,
        resourceId: grant.resourceId,
        principalId: grant.principalId,
        role: grant.permissionType === "owner" ? "Owner" : grant.permissionType === "write" ? "Edit" : "Read",
        grantType: grant.permissionSource === "sharing_link" ? "SharingLink" : grant.inherit ? "Inherited" : "Direct",
        linkType: grant.permissionSource === "sharing_link"
          ? principal?.principalType === "Everyone" || principal?.principalType === "EveryoneExceptExternalUsers" ? "Organization" : "SpecificPeople"
          : undefined,
        createdDate: new Date(grant.createdDate).toISOString(),
      };
    }),
  };
}

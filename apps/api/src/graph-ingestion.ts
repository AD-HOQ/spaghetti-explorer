import type { PoolClient } from "pg";
import { requireProductionMode } from "./config.js";
import { replaceNodePermissions, transaction, upsertNode, upsertPrincipal } from "./graph-repository.js";
import { GraphThrottleInfo, HttpGraphClient } from "./microsoft-graph-client.js";

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string };
type Identity = { id?: string; displayName?: string; email?: string };
type Permission = {
  id: string;
  roles?: string[];
  inheritedFrom?: unknown;
  link?: unknown;
  grantedToV2?: { user?: Identity; group?: Identity; siteUser?: Identity };
  grantedToIdentitiesV2?: Array<{ user?: Identity; group?: Identity; siteUser?: Identity }>;
};
type DriveItem = {
  id: string;
  name: string;
  webUrl?: string;
  folder?: unknown;
};
type Drive = { id: string; name: string; webUrl?: string; driveType?: string };

export class GraphIngestor {
  private readonly graph: HttpGraphClient;

  constructor(
    token: string,
    private readonly tenantId: string,
    onThrottle?: (info: GraphThrottleInfo) => void,
    onThrottleRecovered?: () => void,
  ) {
    this.graph = new HttpGraphClient(token, { maxThrottleRetries: 12, onThrottle, onThrottleRecovered });
  }

  private async get<T>(pathOrUrl: string): Promise<T> {
    return this.graph.request<T>("GET", pathOrUrl);
  }

  private async all<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: GraphPage<T> = await this.get<GraphPage<T>>(next);
      values.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return values;
  }

  async ingestSite(siteId: string): Promise<{ nodes: number; permissions: number }> {
    requireProductionMode("Live SharePoint ingestion");
    let nodeCount = 0;
    let permissionCount = 0;
    await transaction(async (client) => {
      const site = await this.get<{ id: string; displayName?: string; name?: string; webUrl?: string }>(`/sites/${siteId}`);
      // Replace only the selected site's stored subtree so removed libraries/items do not remain stale.
      // Other site roots in the tenant are intentionally left untouched.
      await client.query(
        "DELETE FROM document_nodes WHERE tenant_id = $1 AND source_system = 'SharePoint' AND source_id = $2",
        [this.tenantId, `site:${site.id}`],
      );
      const siteNodeId = await upsertNode(client, {
        tenantId: this.tenantId,
        parentId: null,
        nodeType: "site",
        name: site.displayName ?? site.name ?? site.id,
        path: site.webUrl ?? null,
        depth: 0,
        sourceSystem: "SharePoint",
        sourceId: `site:${site.id}`,
      });
      nodeCount += 1;

      const drives = await this.all<Drive>(`/sites/${siteId}/drives`);
      for (const drive of drives) {
        const libraryId = await upsertNode(client, {
          tenantId: this.tenantId,
          parentId: siteNodeId,
          nodeType: "library",
          name: drive.name,
          path: drive.webUrl ?? null,
          depth: 1,
          sourceSystem: drive.driveType === "personal" ? "OneDrive" : "SharePoint",
          sourceId: `drive:${drive.id}`,
        });
        nodeCount += 1;
        permissionCount += await this.ingestPermissions(client, drive.id, "root", libraryId, true);
        const children = await this.all<DriveItem>(`/drives/${drive.id}/root/children`);
        for (const child of children) {
          const result = await this.ingestItem(client, drive.id, child, libraryId, 2);
          nodeCount += result.nodes;
          permissionCount += result.permissions;
        }
      }
      await client.query("SELECT rebuild_document_node_closure($1)", [this.tenantId]);
      await client.query("SELECT refresh_effective_access($1)", [this.tenantId]);
    });
    return { nodes: nodeCount, permissions: permissionCount };
  }

  async refreshNodePermissions(driveId: string, itemId: string, nodeId: string, isRoot = false) {
    requireProductionMode("Live SharePoint permission refresh");
    return transaction(async (client) => {
      const permissions = await this.ingestPermissions(client, driveId, itemId, nodeId, isRoot);
      await client.query("SELECT refresh_effective_access($1)", [this.tenantId]);
      return { permissions };
    });
  }

  private async ingestItem(client: PoolClient, driveId: string, item: DriveItem, parentId: string, depth: number) {
    const nodeId = await upsertNode(client, {
      tenantId: this.tenantId,
      parentId,
      nodeType: item.folder ? "folder" : "document",
      name: item.name,
      path: item.webUrl ?? null,
      depth,
      sourceSystem: "SharePoint",
      sourceId: `driveItem:${driveId}:${item.id}`,
    });
    let nodes = 1;
    let permissions = await this.ingestPermissions(client, driveId, item.id, nodeId);
    if (item.folder) {
      for (const child of await this.all<DriveItem>(`/drives/${driveId}/items/${item.id}/children`)) {
        const result = await this.ingestItem(client, driveId, child, nodeId, depth + 1);
        nodes += result.nodes;
        permissions += result.permissions;
      }
    }
    return { nodes, permissions };
  }

  private async ingestPermissions(client: PoolClient, driveId: string, itemId: string, nodeId: string, isRoot = false) {
    const permissionPath = isRoot
      ? `/drives/${driveId}/root/permissions`
      : `/drives/${driveId}/items/${itemId}/permissions`;
    const graphPermissions = await this.all<Permission>(permissionPath);
    const rows: Array<{ principalId: string; type: string; inherited: boolean; source: string }> = [];
    for (const permission of graphPermissions) {
      const identities = [
        ...(permission.grantedToIdentitiesV2 ?? []),
        ...(permission.grantedToV2 ? [permission.grantedToV2] : []),
      ];
      for (const identitySet of identities) {
        const identity = identitySet.user ?? identitySet.group ?? identitySet.siteUser;
        if (!identity?.id) continue;
        const principalId = await upsertPrincipal(client, {
          tenantId: this.tenantId,
          principalType: identitySet.group ? "group" : "user",
          displayName: identity.displayName ?? identity.email ?? identity.id,
          email: identity.email ?? null,
          externalId: identity.id,
        });
        for (const role of permission.roles ?? ["read"]) {
          rows.push({
            principalId,
            type: mapGraphRole(role),
            inherited: Boolean(permission.inheritedFrom),
            source: permission.link ? "sharing_link" : permission.inheritedFrom ? "inherited" : "direct",
          });
        }
      }
    }
    await replaceNodePermissions(client, this.tenantId, nodeId, rows);
    return rows.length;
  }

}

function mapGraphRole(role: string): "read" | "write" | "owner" {
  if (role === "owner") return "owner";
  if (role === "write") return "write";
  return "read";
}

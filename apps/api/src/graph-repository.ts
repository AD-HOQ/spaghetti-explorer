import type { PoolClient } from "pg";
import { pool } from "./db.js";

export type GraphNodeInput = {
  tenantId: string;
  parentId: string | null;
  nodeType: "site" | "library" | "folder" | "document";
  name: string;
  path: string | null;
  depth: number;
  sourceSystem: "SharePoint" | "OneDrive";
  sourceId: string;
};

export type PrincipalInput = {
  tenantId: string;
  principalType: "user" | "guest" | "group" | "role" | "team";
  displayName: string;
  email: string | null;
  jobTitle?: string | null;
  description?: string | null;
  groupType?: "domain" | "m365" | "security" | null;
  externalId: string;
};

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertNode(client: PoolClient, node: GraphNodeInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO document_nodes
      (tenant_id, parent_id, node_type, name, path, depth, source_system, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, source_system, source_id) DO UPDATE SET
       parent_id = EXCLUDED.parent_id, node_type = EXCLUDED.node_type,
       name = EXCLUDED.name, path = EXCLUDED.path, depth = EXCLUDED.depth,
       updated_at = now()
     RETURNING id`,
    [node.tenantId, node.parentId, node.nodeType, node.name, node.path, node.depth, node.sourceSystem, node.sourceId],
  );
  return result.rows[0].id;
}

export async function upsertPrincipal(client: PoolClient, principal: PrincipalInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO principals
      (tenant_id, principal_type, display_name, email, job_title, description, group_type, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, external_id) DO UPDATE SET
       principal_type = EXCLUDED.principal_type, display_name = EXCLUDED.display_name,
       email = EXCLUDED.email, job_title = EXCLUDED.job_title,
       description = EXCLUDED.description, group_type = EXCLUDED.group_type,
       is_active = true, updated_at = now()
     RETURNING id`,
    [
      principal.tenantId, principal.principalType, principal.displayName, principal.email,
      principal.jobTitle ?? null, principal.description ?? null, principal.groupType ?? null,
      principal.externalId,
    ],
  );
  return result.rows[0].id;
}

export async function replaceNodePermissions(
  client: PoolClient,
  tenantId: string,
  nodeId: string,
  permissions: Array<{ principalId: string; type: string; inherited: boolean; source: string }>,
) {
  await client.query("DELETE FROM permissions WHERE tenant_id = $1 AND node_id = $2", [tenantId, nodeId]);
  for (const permission of permissions) {
    await client.query(
      `INSERT INTO permissions
        (tenant_id, node_id, principal_id, permission_type, effect, inherit, permission_source)
       VALUES ($1, $2, $3, $4, 'allow', $5, $6)
       ON CONFLICT DO NOTHING`,
      [tenantId, nodeId, permission.principalId, permission.type, permission.inherited, permission.source],
    );
  }
}

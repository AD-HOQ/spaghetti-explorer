import { isDemoMode, requireProductionEnvironment } from "./config.js";
import { pool } from "./db.js";
import { GraphIngestor } from "./graph-ingestion.js";
import { GraphClient, HttpGraphClient, MicrosoftGraphError } from "./microsoft-graph-client.js";
import { decryptSecret, MicrosoftOnboardingStore } from "./microsoft-onboarding-store.js";
import { requestConnectorToken } from "./microsoft-tenant-provisioning.js";
import { PermissionActionExecutionResult } from "./permission-action-service.js";
import { PermissionActionRecord } from "./permission-action-log-store.js";

type Command = {
  operation?: string;
  accessPath?: string;
  targetPrincipalId?: string;
  sourcePrincipalId?: string;
  permissionLevel?: PermissionLevel;
  sharingLinkType?: "view" | "edit";
  sharingLinkScope?: "users" | "organization" | "anonymous";
};
type PermissionLevel = "Read" | "Edit" | "Contribute" | "Design" | "Full Control";
type GraphIdentity = { id?: string; email?: string };
type GraphPermission = {
  id: string;
  inheritedFrom?: unknown;
  link?: unknown;
  grantedToV2?: { user?: GraphIdentity; group?: GraphIdentity; siteUser?: GraphIdentity };
  grantedToIdentitiesV2?: Array<{ user?: GraphIdentity; group?: GraphIdentity; siteUser?: GraphIdentity }>;
};
type CreateLinkResponse = { link?: { webUrl?: string } };

type NodeTarget = {
  tenantId: string;
  sourceId: string;
};
type PrincipalTarget = {
  externalId: string;
  email: string | null;
};

export class PermissionActionExecutor {
  constructor(
    private readonly store = new MicrosoftOnboardingStore(),
    private readonly graphFactory: (token: string) => GraphClient = (token) => new HttpGraphClient(token),
    private readonly tokenAcquirer = requestConnectorToken,
  ) {}

  async execute(action: PermissionActionRecord): Promise<PermissionActionExecutionResult> {
    if (isDemoMode) {
      return { executedAt: new Date().toISOString(), message: `Demo Microsoft command completed for ${action.nodeName}.` };
    }
    requireProductionEnvironment(["DATABASE_URL", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
    const command = action.command as Command;
    const node = await this.nodeTarget(action.nodeId);
    const connection = await this.store.getInternal(node.tenantId);
    if (!connection?.clientId || !connection.encryptedClientSecret || !["connected", "credential_expiring_soon"].includes(connection.status)) {
      throw new Error("A connected remediation connector is required before running permission actions.");
    }
    let token: string;
    try {
      token = await this.tokenAcquirer(node.tenantId, connection.clientId, decryptSecret(connection.encryptedClientSecret));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector token acquisition failed.";
      await this.store.updateStatus(node.tenantId, "failed", "The stored remediation connector could not authenticate.", message);
      await this.store.audit("connector_authentication", node.tenantId, "failed", { message });
      throw new Error(`The stored remediation connector could not authenticate. Reauthorize an administrator and provision a replacement connector. ${message}`);
    }
    const graph = this.graphFactory(token);
    const resource = parseDriveResource(node.sourceId);

    if (command.operation === "add_permission_grant") {
      await this.addPermission(graph, resource, command);
    } else if (command.operation === "remove_principal_from_group") {
      await this.removeGroupMember(graph, command);
    } else if (["remove_direct_permission", "remove_security_group_permission", "remove_m365_group_permission", "remove_sharing_link_user", "delete_sharing_link", "remove_principal_permission"].includes(command.operation ?? "")) {
      await this.removePermission(graph, resource, command);
    } else if (command.operation === "break_inheritance" || command.operation === "reset_inheritance") {
      throw new Error("Inheritance remediation requires a separately authorized SharePoint REST connector and is not executable yet.");
    } else {
      throw new Error(`Unsupported permission action: ${command.operation ?? "unknown"}.`);
    }

    void new GraphIngestor(token, node.tenantId)
      .refreshNodePermissions(resource.driveId, resource.itemId, action.nodeId, resource.isRoot)
      .catch(() => undefined);
    return {
      executedAt: new Date().toISOString(),
      message: `Microsoft Graph accepted ${command.operation?.replaceAll("_", " ") ?? "permission action"} for ${action.nodeName}. Local permission details are refreshing in the background.`,
    };
  }

  private async addPermission(graph: GraphClient, resource: DriveResource, command: Command) {
    if (command.accessPath === "sharing_link") {
      if (resource.isRoot) throw new Error("Sharing links cannot be created on a document library root. Select a folder or file.");
      const link = await graph.request<CreateLinkResponse>("POST", `/drives/${resource.driveId}/${resource.itemPath}/createLink`, sharingLinkPayload(command));
      if (command.sharingLinkScope === "users") {
        const principal = await this.principalTarget(command.targetPrincipalId);
        const webUrl = link.link?.webUrl;
        if (!webUrl) throw new Error("Microsoft Graph created a sharing link but did not return a webUrl to grant to the selected user.");
        await graph.request("POST", `/shares/${encodeSharingUrl(webUrl)}/permission/grant`, {
          recipients: [principal.email ? { email: principal.email } : { objectId: principal.externalId }],
          roles: [command.sharingLinkType === "edit" ? "write" : "read"],
        });
      }
      return;
    }
    if (command.accessPath === "sharepoint_group") {
      throw new Error("SharePoint-local group grants require the separately authorized SharePoint REST connector.");
    }
    const principal = await this.principalTarget(command.targetPrincipalId);
    const recipient = principal.email ? { email: principal.email } : { objectId: principal.externalId };
    await graph.request("POST", `/drives/${resource.driveId}/${resource.itemPath}/invite`, {
      recipients: [recipient],
      requireSignIn: true,
      sendInvitation: false,
      roles: [graphRoleForPermissionLevel(command.permissionLevel)],
    });
  }

  private async removePermission(graph: GraphClient, resource: DriveResource, command: Command) {
    if (command.operation === "remove_sharing_link_user") {
      throw new Error("Microsoft Graph can delete the entire sharing link permission, but cannot safely remove only one user from that link. This action requires an explicit delete-link confirmation.");
    }
    const principal = await this.principalTarget(command.targetPrincipalId);
    const response = await graph.request<{ value: GraphPermission[] }>("GET", `/drives/${resource.driveId}/${resource.itemPath}/permissions`);
    const permission = findPermissionForPrincipal(response.value, principal, command.accessPath);
    if (!permission) return;
    if (permission.inheritedFrom) throw new Error("Microsoft Graph cannot delete an inherited permission. Stop inheritance first using an authorized SharePoint remediation connector.");
    try {
      await graph.request("DELETE", `/drives/${resource.driveId}/${resource.itemPath}/permissions/${permission.id}`);
    } catch (error) {
      if (!(error instanceof MicrosoftGraphError) || error.status !== 404) throw error;
    }
  }

  private async removeGroupMember(graph: GraphClient, command: Command) {
    const member = await this.principalTarget(command.targetPrincipalId);
    const group = await this.principalTarget(command.sourcePrincipalId);
    try {
      await graph.request("DELETE", `/groups/${group.externalId}/members/${member.externalId}/$ref`);
    } catch (error) {
      if (!(error instanceof MicrosoftGraphError) || error.status !== 404) throw error;
    }
  }

  private async nodeTarget(nodeId: string): Promise<NodeTarget> {
    const result = await pool.query<NodeTarget>(
      `WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, tenant_id, source_id, node_type FROM document_nodes WHERE id = $1
        UNION ALL
        SELECT parent.id, parent.parent_id, parent.tenant_id, parent.source_id, parent.node_type
        FROM document_nodes parent JOIN ancestors child ON child.parent_id = parent.id
      )
      SELECT current.tenant_id AS "tenantId", current.source_id AS "sourceId"
      FROM document_nodes current WHERE current.id = $1`,
      [nodeId],
    );
    if (!result.rows[0]) throw new Error("The selected resource was not found in the ingested tenant database.");
    return result.rows[0];
  }

  private async principalTarget(principalId?: string): Promise<PrincipalTarget> {
    if (!principalId) throw new Error("The permission action does not identify a target principal.");
    const result = await pool.query<PrincipalTarget>(
      `SELECT external_id AS "externalId", email FROM principals WHERE id = $1`,
      [principalId],
    );
    if (!result.rows[0]) throw new Error("The selected principal was not found in the ingested tenant database.");
    return result.rows[0];
  }
}

export function graphRoleForPermissionLevel(permissionLevel: PermissionLevel = "Read") {
  if (permissionLevel === "Read") return "read";
  if (permissionLevel === "Contribute") return "write";
  throw new Error(`${permissionLevel} grants require the separately authorized SharePoint REST connector.`);
}

export function sharingLinkPayload(command: Pick<Command, "sharingLinkType" | "sharingLinkScope">) {
  return {
    type: command.sharingLinkType ?? "view",
    scope: command.sharingLinkScope ?? "users",
    retainInheritedPermissions: true,
  };
}

export function encodeSharingUrl(webUrl: string) {
  const base64 = Buffer.from(webUrl, "utf8").toString("base64");
  return `u!${base64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

export type DriveResource = { driveId: string; itemId: string; itemPath: string; isRoot: boolean };
export function parseDriveResource(sourceId: string): DriveResource {
  if (sourceId.startsWith("driveItem:")) {
    const [, driveId, itemId] = sourceId.split(":");
    if (driveId && itemId) return { driveId, itemId, itemPath: `items/${itemId}`, isRoot: false };
  }
  if (sourceId.startsWith("drive:")) {
    const driveId = sourceId.slice(6);
    if (driveId) return { driveId, itemId: "root", itemPath: "root", isRoot: true };
  }
  if (sourceId.startsWith("site:")) {
    throw new Error("Site-level permission remediation is not supported by the current Graph connector. Select a library, folder, or file.");
  }
  throw new Error("This resource is not a Graph drive item and cannot be remediated by the current connector.");
}

function identities(permission: GraphPermission) {
  const identitySets = [...(permission.grantedToIdentitiesV2 ?? []), ...(permission.grantedToV2 ? [permission.grantedToV2] : [])];
  return identitySets.flatMap((identitySet) => [identitySet.user, identitySet.group, identitySet.siteUser].filter((identity): identity is GraphIdentity => Boolean(identity)));
}

export function findPermissionForPrincipal(permissions: GraphPermission[], principal: PrincipalTarget, accessPath?: string) {
  return permissions.find((candidate) => {
    if (accessPath === "sharing_link" && !candidate.link) return false;
    return identities(candidate).some((identity) => identity.id === principal.externalId || Boolean(principal.email && identity.email === principal.email));
  });
}

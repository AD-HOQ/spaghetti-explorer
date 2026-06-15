import { GraphClient, HttpGraphClient, MicrosoftGraphError, withRetry } from "./microsoft-graph-client.js";
import { requireProductionMode } from "./config.js";

export const microsoftGraphResourceAppId = process.env.MICROSOFT_GRAPH_RESOURCE_APP_ID ?? "00000003-0000-0000-c000-000000000000";
export const connectorPermissions = (process.env.MICROSOFT_CONNECTOR_PERMISSIONS
  ?? process.env.MICROSOFT_CONNECTOR_READ_PERMISSIONS
  ?? "Directory.Read.All,Group.Read.All,GroupMember.ReadWrite.All,User.Read.All,Sites.ReadWrite.All,Files.ReadWrite.All")
  .split(",")
  .map((permission) => permission.trim())
  .filter(Boolean);
export const readOnlyConnectorPermissions = connectorPermissions;

type GraphApplication = { id: string; appId: string; displayName: string };
type GraphServicePrincipal = {
  id: string;
  appId: string;
  appRoles?: Array<{ id: string; value: string | null; isEnabled: boolean; allowedMemberTypes: string[] }>;
};
type Credential = { secretText: string; keyId: string; endDateTime: string };

export type ProvisioningProgress =
  | "provisioning_app_registration"
  | "creating_service_principal"
  | "granting_graph_permissions"
  | "verifying_graph_access";

export type ProvisioningResult = {
  tenantId: string;
  tenantDisplayName: string;
  applicationObjectId: string;
  clientId: string;
  servicePrincipalObjectId: string;
  clientSecret: string;
  credentialKeyId: string;
  credentialExpiresAt: string;
  grantedPermissions: string[];
  lastVerifiedAt: string;
};
type ConnectorTokenAcquirer = (tenantId: string, clientId: string, clientSecret: string) => Promise<string>;
type ConnectorGraphFactory = (accessToken: string) => GraphClient;

export function isTransientConnectorVerificationError(error: unknown) {
  return error instanceof MicrosoftGraphError
    && error.status === 401
    && error.responseBody.includes("Authorization_IdentityNotFound");
}

export function resolveGraphAppRoles(servicePrincipal: GraphServicePrincipal, permissions: string[]) {
  const roles = new Map(
    (servicePrincipal.appRoles ?? [])
      .filter((role) => role.isEnabled && role.value && role.allowedMemberTypes.includes("Application"))
      .map((role) => [role.value as string, role.id]),
  );
  const missing = permissions.filter((permission) => !roles.has(permission));
  if (missing.length) throw new Error(`Microsoft Graph does not expose these application permissions: ${missing.join(", ")}`);
  return permissions.map((permission) => ({ permission, appRoleId: roles.get(permission) as string }));
}

export class MicrosoftTenantProvisioning {
  constructor(
    private readonly bootstrapGraph: GraphClient,
    private readonly onProgress: (progress: ProvisioningProgress) => Promise<void> | void = () => undefined,
    private readonly tokenAcquirer: ConnectorTokenAcquirer = requestConnectorToken,
    private readonly connectorGraphFactory: ConnectorGraphFactory = (accessToken) => new HttpGraphClient(accessToken),
  ) {}

  async provision(input: { tenantId: string; productName: string; permissions?: string[] }): Promise<ProvisioningResult> {
    const permissions = input.permissions ?? connectorPermissions;
    const organization = await this.bootstrapGraph.request<{ value: Array<{ id: string; displayName: string }> }>(
      "GET",
      "/organization?$select=id,displayName",
    );
    const tenant = organization.value[0];
    if (!tenant || tenant.id !== input.tenantId) throw new Error("The authorized Microsoft tenant does not match the onboarding tenant.");

    await this.onProgress("provisioning_app_registration");
    const graphServicePrincipal = await this.findGraphServicePrincipal();
    const resolvedRoles = resolveGraphAppRoles(graphServicePrincipal, permissions);
    const application = await this.bootstrapGraph.request<GraphApplication>("POST", "/applications", {
      displayName: `${input.productName} Connector - Remediation`,
      signInAudience: "AzureADMyOrg",
      requiredResourceAccess: [{
        resourceAppId: microsoftGraphResourceAppId,
        resourceAccess: resolvedRoles.map((role) => ({ id: role.appRoleId, type: "Role" })),
      }],
      tags: ["Spaghetti Explorer", "Spaghetti Connector:Remediation"],
    });

    await this.onProgress("creating_service_principal");
    const connectorServicePrincipal = await withRetry(
      () => this.bootstrapGraph.request<GraphServicePrincipal>("POST", "/servicePrincipals", { appId: application.appId }),
      { shouldRetry: (error) => error instanceof MicrosoftGraphError && [400, 404, 409].includes(error.status) },
    );

    const credential = await this.bootstrapGraph.request<Credential>("POST", `/applications/${application.id}/addPassword`, {
      passwordCredential: {
        displayName: "Spaghetti Connector Credential",
        endDateTime: new Date(Date.now() + 180 * 86400000).toISOString(),
      },
    });

    await this.onProgress("granting_graph_permissions");
    for (const role of resolvedRoles) {
      await this.bootstrapGraph.request("POST", `/servicePrincipals/${graphServicePrincipal.id}/appRoleAssignedTo`, {
        principalId: connectorServicePrincipal.id,
        resourceId: graphServicePrincipal.id,
        appRoleId: role.appRoleId,
      });
    }

    await this.onProgress("verifying_graph_access");
    const connectorToken = await withRetry<string>(
      () => this.tokenAcquirer(input.tenantId, application.appId, credential.secretText),
      { attempts: 6, initialDelayMs: 500 },
    );
    const connectorGraph = this.connectorGraphFactory(connectorToken);
    await withRetry(
      () => verifyConnectorGraphAccess(connectorGraph),
      {
        attempts: 8,
        initialDelayMs: 1000,
        shouldRetry: isTransientConnectorVerificationError,
      },
    );

    return {
      tenantId: input.tenantId,
      tenantDisplayName: tenant.displayName,
      applicationObjectId: application.id,
      clientId: application.appId,
      servicePrincipalObjectId: connectorServicePrincipal.id,
      clientSecret: credential.secretText,
      credentialKeyId: credential.keyId,
      credentialExpiresAt: credential.endDateTime,
      grantedPermissions: permissions,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  async disconnect(applicationObjectId: string, servicePrincipalObjectId: string, deleteApplication = false) {
    try {
      if (deleteApplication) {
        await this.bootstrapGraph.request("DELETE", `/applications/${applicationObjectId}`);
        return "deleted" as const;
      }
      await this.bootstrapGraph.request("PATCH", `/servicePrincipals/${servicePrincipalObjectId}`, { accountEnabled: false });
      return "disabled" as const;
    } catch (error) {
      if (error instanceof MicrosoftGraphError && error.status === 404) return "already_removed" as const;
      throw error;
    }
  }

  private async findGraphServicePrincipal() {
    const response = await this.bootstrapGraph.request<{ value: GraphServicePrincipal[] }>(
      "GET",
      `/servicePrincipals?$filter=appId eq '${microsoftGraphResourceAppId}'&$select=id,appId,appRoles`,
    );
    const graphServicePrincipal = response.value[0];
    if (!graphServicePrincipal) throw new Error("Microsoft Graph service principal was not found in the customer tenant.");
    return graphServicePrincipal;
  }
}

export async function requestConnectorToken(tenantId: string, clientId: string, clientSecret: string) {
  requireProductionMode("Microsoft connector token acquisition");
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const result = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    const description = result.error_description ?? "";
    if (description.includes("AADSTS700016")) {
      throw new Error("Microsoft could not find the stored remediation connector application in this tenant. Provision a replacement connector.");
    }
    if (description.includes("AADSTS7000215") || description.includes("AADSTS7000222")) {
      throw new Error("The stored remediation connector credential is invalid or expired. Provision a replacement connector.");
    }
    throw new Error("Connector client-credentials verification failed. Reauthorize an administrator and provision a replacement connector.");
  }
  return result.access_token;
}

export async function verifyConnectorGraphAccess(graph: GraphClient) {
  await graph.request("GET", "/organization?$select=id,displayName");
  await graph.request("GET", "/users?$top=1&$select=id");
  await graph.request("GET", "/groups?$top=1&$select=id");
  await graph.request("GET", "/sites/root?$select=id");
}

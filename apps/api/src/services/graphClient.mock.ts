import { demoTenantId } from "../demo.js";
import { MockGraphClient } from "../microsoft-graph-client.js";

export const demoTenantConnection = {
  tenantId: demoTenantId,
  tenantDisplayName: "Contoso Demo Tenant",
  clientId: "00000000-0000-0000-0000-000000000000",
  createdByUpn: "admin@contoso-demo.com",
  credentialExpiresAt: null,
  lastVerifiedAt: new Date("2026-01-15T12:00:00.000Z").toISOString(),
  grantedPermissions: ["Directory.Read.All", "Group.Read.All", "User.Read.All", "Sites.ReadWrite.All", "Files.ReadWrite.All"],
  status: "connected",
  health: "Demo Microsoft Graph connector is active. No external Microsoft services are called.",
};

export function createDemoGraphClient() {
  return new MockGraphClient(({ method, path }) => ({
    mode: "demo",
    method,
    path,
    tenant: demoTenantConnection.tenantDisplayName,
  }));
}

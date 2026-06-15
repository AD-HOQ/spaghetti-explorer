import assert from "node:assert/strict";
import test from "node:test";
import { MicrosoftGraphError, MockGraphClient, withRetry } from "./microsoft-graph-client.js";
import { decryptSecret, encryptSecret } from "./microsoft-onboarding-store.js";
import { connectorPermissions, isTransientConnectorVerificationError, MicrosoftTenantProvisioning, resolveGraphAppRoles, verifyConnectorGraphAccess } from "./microsoft-tenant-provisioning.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const connectorSpId = "44444444-4444-4444-8444-444444444444";
const graphSpId = "55555555-5555-4555-8555-555555555555";
const roleId = "66666666-6666-4666-8666-666666666666";

test("default connector profile includes Graph remediation permissions", () => {
  assert.ok(connectorPermissions.includes("Sites.ReadWrite.All"));
  assert.ok(connectorPermissions.includes("Files.ReadWrite.All"));
  assert.ok(connectorPermissions.includes("GroupMember.ReadWrite.All"));
});

test("resolves Microsoft Graph application role IDs dynamically", () => {
  assert.deepEqual(resolveGraphAppRoles({
    id: graphSpId,
    appId: "00000003-0000-0000-c000-000000000000",
    appRoles: [{ id: roleId, value: "Sites.Read.All", isEnabled: true, allowedMemberTypes: ["Application"] }],
  }, ["Sites.Read.All"]), [{ permission: "Sites.Read.All", appRoleId: roleId }]);
});

test("provisions a customer-owned connector and grants resolved role assignments", async () => {
  const progress: string[] = [];
  const graph = new MockGraphClient(({ method, path }) => {
    if (path.startsWith("/organization")) return { value: [{ id: tenantId, displayName: "Contoso" }] };
    if (path.startsWith("/servicePrincipals?$filter")) return { value: [{ id: graphSpId, appId: "graph", appRoles: [{ id: roleId, value: "Sites.Read.All", isEnabled: true, allowedMemberTypes: ["Application"] }] }] };
    if (method === "POST" && path === "/applications") return { id: applicationId, appId: clientId, displayName: "Spaghetti Connector - Remediation" };
    if (method === "POST" && path === "/servicePrincipals") return { id: connectorSpId, appId: clientId };
    if (path.endsWith("/addPassword")) return { secretText: "TEST_PLACEHOLDER_NOT_A_SECRET", keyId: roleId, endDateTime: "2027-01-01T00:00:00.000Z" };
    if (path.endsWith("/appRoleAssignedTo")) return {};
    throw new Error(`Unexpected ${method} ${path}`);
  });
  const result = await new MicrosoftTenantProvisioning(
    graph,
    (state) => { progress.push(state); },
    async () => "TEST_PLACEHOLDER_NOT_A_TOKEN",
    () => new MockGraphClient(() => ({})),
  ).provision({ tenantId, productName: "Spaghetti", permissions: ["Sites.Read.All"] });

  assert.equal(result.clientId, clientId);
  assert.deepEqual(progress, ["provisioning_app_registration", "creating_service_principal", "granting_graph_permissions", "verifying_graph_access"]);
  const roleAssignment = graph.requests.find((request) => request.path.endsWith("/appRoleAssignedTo"));
  assert.deepEqual(roleAssignment?.body, { principalId: connectorSpId, resourceId: graphSpId, appRoleId: roleId });
});

test("retries eventual consistency failures", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new MicrosoftGraphError("not ready", 404, "");
    return "ready";
  }, { attempts: 3, initialDelayMs: 1 });
  assert.equal(result, "ready");
  assert.equal(attempts, 3);
});

test("connector verification calls the conservative read endpoints", async () => {
  const graph = new MockGraphClient(() => ({}));
  await verifyConnectorGraphAccess(graph);
  assert.deepEqual(graph.requests.map((request) => request.path), [
    "/organization?$select=id,displayName",
    "/users?$top=1&$select=id",
    "/groups?$top=1&$select=id",
    "/sites/root?$select=id",
  ]);
});

test("connector verification exposes a failure", async () => {
  const graph = new MockGraphClient(({ path }) => {
    if (path.startsWith("/users")) throw new MicrosoftGraphError("forbidden", 403, "");
    return {};
  });
  await assert.rejects(() => verifyConnectorGraphAccess(graph), /forbidden/);
});

test("connector verification retries while a new service principal identity propagates", async () => {
  let attempts = 0;
  const graph = new MockGraphClient(({ path }) => {
    if (path.startsWith("/users")) {
      attempts += 1;
      if (attempts < 3) {
        throw new MicrosoftGraphError(
          "identity not found",
          401,
          JSON.stringify({ error: { code: "Authorization_IdentityNotFound" } }),
        );
      }
    }
    return {};
  });
  await withRetry(
    () => verifyConnectorGraphAccess(graph),
    { attempts: 3, initialDelayMs: 1, shouldRetry: isTransientConnectorVerificationError },
  );
  assert.equal(attempts, 3);
});

test("disconnect disables the service principal by default and tolerates prior deletion", async () => {
  const graph = new MockGraphClient(() => ({}));
  const provisioner = new MicrosoftTenantProvisioning(graph);
  assert.equal(await provisioner.disconnect(applicationId, connectorSpId), "disabled");
  assert.deepEqual(graph.requests[0], { method: "PATCH", path: `/servicePrincipals/${connectorSpId}`, body: { accountEnabled: false } });

  const missing = new MicrosoftTenantProvisioning(new MockGraphClient(() => { throw new MicrosoftGraphError("missing", 404, ""); }));
  assert.equal(await missing.disconnect(applicationId, connectorSpId), "already_removed");
});

test("connector credentials are encrypted at rest", () => {
  process.env.MICROSOFT_SECRET_ENCRYPTION_KEY = "TEST_PLACEHOLDER_ENCRYPTION_KEY";
  const encrypted = encryptSecret("TEST_PLACEHOLDER_NOT_A_SECRET");
  assert.notEqual(encrypted, "TEST_PLACEHOLDER_NOT_A_SECRET");
  assert.equal(decryptSecret(encrypted), "TEST_PLACEHOLDER_NOT_A_SECRET");
});

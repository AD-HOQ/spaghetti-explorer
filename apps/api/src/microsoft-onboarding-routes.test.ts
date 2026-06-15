import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { microsoftOnboardingRouter } from "./microsoft-onboarding-routes.js";

async function testServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/microsoft/connect", microsoftOnboardingRouter());
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

test("connect start stays inside the application in default demo mode", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/start`, { redirect: "manual" });
  const location = new URL(response.headers.get("location") as string, url);
  assert.equal(response.status, 302);
  assert.equal(location.pathname, "/admin");
  assert.equal(location.searchParams.get("microsoft"), "demo");
});

test("callback does not exchange authorization codes in default demo mode", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/callback?code=authorization-code-value&state=unknown-state-value`, { redirect: "manual" });
  const location = new URL(response.headers.get("location") as string, url);
  assert.equal(response.status, 302);
  assert.equal(location.pathname, "/admin");
  assert.equal(location.searchParams.get("microsoft"), "demo");
});

test("callback without Microsoft parameters remains safely in demo mode", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/callback`, { redirect: "manual" });
  const location = new URL(response.headers.get("location") as string, url);
  assert.equal(response.status, 302);
  assert.equal(location.pathname, "/admin");
  assert.equal(location.searchParams.get("microsoft"), "demo");
});

test("demo connector discovers synthetic SharePoint sites", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/sites`);
  const result = await response.json() as { mode: string; sites: Array<{ id: string; name: string }> };
  assert.equal(response.status, 200);
  assert.equal(result.mode, "demo");
  assert.ok(result.sites.length > 3);
  assert.ok(result.sites.every((site) => site.id && site.name));
});

test("demo status reports production readiness blockers", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const result = await fetch(`${url}/api/microsoft/connect/status`).then((response) => response.json()) as {
    appMode: string;
    productionReadiness: { ready: boolean; requirements: Array<{ name: string; configured: boolean }> };
  };
  assert.equal(result.appMode, "demo");
  assert.equal(result.productionReadiness.ready, false);
  assert.ok(result.productionReadiness.requirements.some((requirement) => requirement.name === "APP_MODE" && !requirement.configured));
  assert.ok(result.productionReadiness.requirements.some((requirement) => requirement.name === "MICROSOFT_BOOTSTRAP_CLIENT_ID"));
  assert.ok(!result.productionReadiness.requirements.some((requirement) => requirement.name === "DATABASE_URL"));
});

test("demo connector scans selected sites and exposes scan job progress without Microsoft credentials", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      siteIds: ["site-one", "site-two"],
    }),
  });
  const result = await response.json() as { jobId: string; status: string; successfulSites: number; nodes: number; permissions: number };
  assert.equal(response.status, 202);
  assert.equal(result.status, "completed");
  assert.equal(result.successfulSites, 2);
  assert.ok(result.nodes > 0);
  assert.ok(result.permissions > 0);
  const progressResponse = await fetch(`${url}/api/microsoft/connect/scan/${result.jobId}`);
  const progress = await progressResponse.json() as { status: string; completedSites: number; requestedSites: number };
  assert.equal(progressResponse.status, 200);
  assert.equal(progress.status, "completed");
  assert.equal(progress.completedSites, progress.requestedSites);
});

test("demo connector exposes an empty persistent scan history", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());
  const response = await fetch(`${url}/api/microsoft/connect/scan-history`);
  const result = await response.json() as { scans: unknown[] };
  assert.equal(response.status, 200);
  assert.deepEqual(result.scans, []);
});

test("demo tenant can disconnect and reconnect without status polling restoring it", async (context) => {
  const { server, url } = await testServer();
  context.after(() => server.close());

  const disconnectedResponse = await fetch(`${url}/api/microsoft/connect/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteApplication: false }),
  });
  assert.equal(disconnectedResponse.status, 200);

  const disconnectedStatus = await fetch(`${url}/api/microsoft/connect/status`).then((response) => response.json()) as {
    administratorAuthorized: boolean;
    connection: { status: string };
  };
  assert.equal(disconnectedStatus.administratorAuthorized, false);
  assert.equal(disconnectedStatus.connection.status, "not_connected");

  const reconnectResponse = await fetch(`${url}/api/microsoft/connect/start`, { redirect: "manual" });
  assert.equal(reconnectResponse.status, 302);

  const connectedStatus = await fetch(`${url}/api/microsoft/connect/status`).then((response) => response.json()) as {
    administratorAuthorized: boolean;
    connection: { status: string };
  };
  assert.equal(connectedStatus.administratorAuthorized, true);
  assert.equal(connectedStatus.connection.status, "connected");
});

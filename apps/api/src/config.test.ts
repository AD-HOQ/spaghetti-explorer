import assert from "node:assert/strict";
import test from "node:test";
import { appMode, isDemoMode, requireProductionMode } from "./config.js";
import { HttpGraphClient } from "./microsoft-graph-client.js";
import { scanDemoSharePointSite } from "./services/sharePointScanner.mock.js";

test("public configuration defaults to demo mode", () => {
  assert.equal(appMode, "demo");
  assert.equal(isDemoMode, true);
  assert.throws(() => requireProductionMode("Live integration"), /disabled while APP_MODE=demo/);
});

test("real Microsoft Graph HTTP client is blocked in demo mode", async () => {
  await assert.rejects(() => new HttpGraphClient("TEST_PLACEHOLDER_NOT_A_TOKEN").request("GET", "/organization"), /disabled while APP_MODE=demo/);
});

test("mock SharePoint scanner returns synthetic data without credentials", async () => {
  const result = await scanDemoSharePointSite();
  assert.equal(result.mode, "demo");
  assert.ok(result.nodes > 1000);
});

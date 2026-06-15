import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { buildPowerAutomateSolutionPackage, listPowerPlatformEnvironments, validatePowerAutomateSolution } from "./power-automate-integration.js";

test("builds a solution package with manifests and approval flow templates", () => {
  const zip = new AdmZip(buildPowerAutomateSolutionPackage());
  const entries = zip.getEntries().map((entry) => entry.entryName);
  assert.ok(entries.includes("solution.xml"));
  assert.ok(entries.includes("customizations.xml"));
  assert.ok(entries.includes("workflows/Spaghetti-Manager-Approval-Request.json"));
  assert.match(zip.readAsText("solution.xml"), /spaghetti_approvals/);
});

test("lists configured demo environments and validates installed state", async () => {
  delete process.env.POWER_PLATFORM_ENVIRONMENTS_JSON;
  assert.equal(listPowerPlatformEnvironments().length, 2);
  const result = await validatePowerAutomateSolution("demo-production");
  assert.equal(result.installed, true);
  assert.equal(result.mode, "demo");
});

test("rejects validation for an unconfigured environment", async () => {
  await assert.rejects(() => validatePowerAutomateSolution("unknown"), /not configured/);
});

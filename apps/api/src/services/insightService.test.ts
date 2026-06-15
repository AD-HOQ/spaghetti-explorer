import assert from "node:assert/strict";
import test from "node:test";
import { demoPermissionGraphData } from "../data/demoPermissionGraph.js";
import type { FabricIqAdapter } from "../insights/fabricIqAdapter.js";
import { createFabricIqAdapter, generateInsightsForGraph, getFabricIqStatus } from "./insightService.js";

test("demo mode does not call Fabric enrichment", async () => {
  let exports = 0;
  let enrichments = 0;
  const adapter: FabricIqAdapter = {
    isConfigured: () => true,
    exportPermissionGraph: async () => { exports += 1; },
    enrichInsights: async (insights) => { enrichments += 1; return insights; },
    getIntegrationStatus: async () => ({ enabled: true, configured: true, mode: "mock", message: "test" }),
  };
  const insights = await generateInsightsForGraph(demoPermissionGraphData, adapter);
  assert.ok(insights.length > 0);
  assert.equal(exports, 0);
  assert.equal(enrichments, 0);
});

test("missing Fabric configuration does not crash local insights", async () => {
  const adapter = createFabricIqAdapter();
  assert.equal(adapter.isConfigured(), false);
  const status = await getFabricIqStatus();
  assert.equal(status.configured, false);
  assert.match(status.message, /local|demo/i);
});

import assert from "node:assert/strict";
import test from "node:test";
import { demoGraph } from "../demo.js";
import { demoPermissionGraphData } from "../data/demoPermissionGraph.js";
import { generateRiskInsights } from "./anomalyEngine.js";

const now = new Date("2026-06-15T00:00:00.000Z");
const insights = generateRiskInsights(demoPermissionGraphData, { now });

for (const type of [
  "DormantBroadExposure",
  "AnonymousSensitiveLink",
  "BrokenInheritanceHighRisk",
  "OwnerlessSite",
  "InactiveSiteBroadAccess",
  "ExternalSharingOnSensitiveContent",
  "LargeGroupAccessToSensitiveContent",
  "CopilotExposureRisk",
] as const) {
  test(`local anomaly engine detects ${type}`, () => {
    const match = insights.find((insight) => insight.type === type);
    assert.ok(match);
    assert.equal(match.source, "LocalRules");
    assert.ok(match.evidence.resourceId);
    assert.ok(match.recommendedAction);
  });
}

test("insight IDs are stable and cards target nodes in the demo graph", () => {
  const repeated = generateRiskInsights(demoPermissionGraphData, { now });
  assert.deepEqual(repeated.map((item) => item.id), insights.map((item) => item.id));
  const nodeIds = new Set(demoGraph().nodes.map((node) => node.id));
  assert.ok(insights.every((insight) => nodeIds.has(insight.nodeIdToOpen)));
});

test("dormant broad exposure records 36+ months of evidence", () => {
  const dormant = insights.find((insight) => insight.type === "DormantBroadExposure");
  assert.ok(dormant);
  assert.ok((dormant.evidence.daysSinceLastAccess ?? 0) >= 1095);
  assert.equal(dormant.title, "Dormant file broadly shared");
});

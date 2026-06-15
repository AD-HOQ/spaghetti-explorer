import assert from "node:assert/strict";
import test from "node:test";
import { demoGraph } from "../demo.js";
import { getDemoRiskInsights } from "./fabricIq.mock.js";

test("synthetic risk insights open stable demo graph nodes", () => {
  const nodeIds = new Set(demoGraph().nodes.map((node) => node.id));
  const insights = getDemoRiskInsights();

  assert.deepEqual(insights.map((insight) => insight.id), ["risk-001", "risk-002", "risk-003"]);
  assert.ok(insights.every((insight) => nodeIds.has(insight.nodeIdToOpen)));
  assert.ok(insights.every((insight) => insight.resourcePath.startsWith("/")));
});

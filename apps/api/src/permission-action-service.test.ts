import assert from "node:assert/strict";
import test from "node:test";
import { PermissionActionEventType, PermissionActionRecord } from "./permission-action-log-store.js";
import { PermissionActionService } from "./permission-action-service.js";

const action: PermissionActionRecord = {
  id: "77777777-7777-4777-8777-777777777777",
  kind: "remove_direct_permission",
  label: "Revoke direct permission",
  nodeId: "node-1",
  nodeName: "Forecast.xlsx",
  command: { provider: "microsoft_graph", method: "DELETE", endpointTemplate: "/permissions/{id}" },
};

test("records running and succeeded events around a successful API call", async () => {
  const events: PermissionActionEventType[] = [];
  const service = new PermissionActionService({ append: async (_action, event) => { events.push(event); } });
  await service.execute(action, async () => ({ message: "Completed", executedAt: new Date().toISOString() }));
  assert.deepEqual(events, ["running", "succeeded"]);
});

test("records a failed event before returning an underlying API failure", async () => {
  const events: PermissionActionEventType[] = [];
  const service = new PermissionActionService({ append: async (_action, event) => { events.push(event); } });
  await assert.rejects(() => service.execute(action, async () => { throw new Error("Microsoft Graph rejected the request."); }), /rejected/);
  assert.deepEqual(events, ["running", "failed"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { graphErrorDetail, graphRetryDelayMs } from "./microsoft-graph-client.js";

test("Graph HTTP failures expose Microsoft's safe error code and message", async () => {
  const responseBody = JSON.stringify({
    error: { code: "InvalidAuthenticationToken", message: "Access token validation failure." },
  });
  assert.equal(graphErrorDetail(responseBody), "InvalidAuthenticationToken: Access token validation failure.");
});

test("Graph throttling honors Retry-After seconds and HTTP dates", () => {
  assert.equal(graphRetryDelayMs("7", 0), 7000);
  assert.equal(graphRetryDelayMs("Sun, 14 Jun 2026 22:00:05 GMT", 0, Date.parse("Sun, 14 Jun 2026 22:00:00 GMT")), 5000);
});

test("Graph throttling fallback uses capped exponential backoff with jitter", () => {
  const first = graphRetryDelayMs(null, 0);
  const capped = graphRetryDelayMs(null, 20);
  assert.ok(first >= 1000 && first < 1250);
  assert.ok(capped >= 60000 && capped < 62000);
});

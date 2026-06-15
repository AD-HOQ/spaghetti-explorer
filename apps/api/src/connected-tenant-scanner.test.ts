import assert from "node:assert/strict";
import test from "node:test";
import { discoverSharePointSites } from "./connected-tenant-scanner.js";
import { MockGraphClient } from "./microsoft-graph-client.js";

test("discovers and sorts SharePoint sites across Graph pages", async () => {
  const nextLink = "https://graph.microsoft.com/v1.0/sites?search=*&$skiptoken=next";
  const graph = new MockGraphClient(({ path }) => {
    if (path.startsWith("/sites/root")) return { id: "site-root", displayName: "Root", webUrl: "https://example.invalid" };
    if (path === "/sites/getAllSites") return { value: [
      { id: "site-all", displayName: "All sites result", webUrl: "https://example.invalid/sites/all" },
      { id: "personal-site", displayName: "Personal", webUrl: "https://example-my.invalid/personal/user", isPersonalSite: true },
    ] };
    if (path.startsWith("/groups?$filter")) return { value: [{ id: "group-1", displayName: "Project group" }] };
    if (path.startsWith("/groups/group-1/sites/root")) return { id: "site-group", displayName: "Project", webUrl: "https://example.invalid/sites/project" };
    return path === nextLink
      ? { value: [{ id: "site-b", displayName: "Beta", webUrl: "https://example.invalid/sites/beta" }] }
      : {
        value: [{ id: "site-a", displayName: "Alpha", webUrl: "https://example.invalid/sites/alpha", siteCollection: { hostname: "example.invalid" } }],
        "@odata.nextLink": nextLink,
      };
  });

  const sites = await discoverSharePointSites(graph);

  assert.deepEqual(sites.map((site) => site.name), ["All sites result", "Alpha", "Beta", "Project", "Root"]);
  assert.ok(!sites.some((site) => site.id === "personal-site"));
  assert.equal(sites.find((site) => site.name === "Alpha")?.hostname, "example.invalid");
  assert.ok(graph.requests.some((request) => request.path === nextLink));
});

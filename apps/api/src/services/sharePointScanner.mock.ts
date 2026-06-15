import { demoGraph, demoTenantId } from "../demo.js";

export async function scanDemoSharePointSite(siteId = "contoso-demo.sharepoint.invalid,synthetic-site-collection,synthetic-site") {
  const graph = demoGraph();
  return {
    ok: true,
    mode: "demo",
    tenantId: demoTenantId,
    siteId,
    nodes: graph.nodes.length,
    permissions: graph.nodes.reduce((count, node) => count + node.accessDetails.grantMethods.length, 0),
    message: "Synthetic SharePoint scan completed without calling Microsoft Graph.",
  };
}

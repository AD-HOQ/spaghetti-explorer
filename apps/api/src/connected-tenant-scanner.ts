import { requireProductionEnvironment, requireProductionMode } from "./config.js";
import { ingestTenantDirectory } from "./directory-ingestion.js";
import { GraphIngestor } from "./graph-ingestion.js";
import { GraphClient, HttpGraphClient } from "./microsoft-graph-client.js";
import { decryptSecret, MicrosoftOnboardingStore } from "./microsoft-onboarding-store.js";
import { requestConnectorToken } from "./microsoft-tenant-provisioning.js";

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string };
type GraphSite = {
  id: string;
  displayName?: string;
  name?: string;
  webUrl?: string;
  isPersonalSite?: boolean;
  siteCollection?: { hostname?: string; hostName?: string };
};
type GraphGroup = { id: string; displayName?: string };

export type DiscoveredSharePointSite = {
  id: string;
  name: string;
  webUrl: string | null;
  hostname: string | null;
};

export type ConnectedSiteScanProgress = {
  stage: "syncing_directory" | "scanning_sites" | "waiting_for_graph";
  currentSiteId: string | null;
  completedSites: number;
  successfulSites: number;
  failedSites: number;
  nodes: number;
  permissions: number;
  failures: Array<{ siteId: string; error: string }>;
  retryAfterMs?: number;
  retryAttempt?: number;
  directory?: Awaited<ReturnType<typeof ingestTenantDirectory>>;
};

async function collectPages<T>(graph: GraphClient, path: string) {
  const values: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: GraphPage<T> = await graph.request("GET", next);
    values.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return values;
}

async function discoverGroupSites(graph: GraphClient) {
  let groups: GraphGroup[] = [];
  try {
    groups = await collectPages<GraphGroup>(
      graph,
      "/groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayName&$top=999",
    );
  } catch {
    return [];
  }
  const sites: GraphSite[] = [];
  for (let index = 0; index < groups.length; index += 10) {
    const batch = groups.slice(index, index + 10);
    const results = await Promise.allSettled(
      batch.map((group) => graph.request<GraphSite>(
        "GET",
        `/groups/${group.id}/sites/root?$select=id,displayName,name,webUrl,siteCollection`,
      )),
    );
    results.forEach((result) => {
      if (result.status === "fulfilled") sites.push(result.value);
    });
  }
  return sites;
}

export async function discoverSharePointSites(graph: GraphClient): Promise<DiscoveredSharePointSite[]> {
  const sites: GraphSite[] = [];
  try {
    sites.push(await graph.request<GraphSite>("GET", "/sites/root?$select=id,displayName,name,webUrl,siteCollection"));
  } catch {
    // Some tenants do not expose a root site, but site search can still succeed.
  }
  const [allSites, searchedSites, rootSubsites, groupSites] = await Promise.all([
    collectPages<GraphSite>(graph, "/sites/getAllSites").catch(() => []),
    collectPages<GraphSite>(graph, "/sites?search=*&$select=id,displayName,name,webUrl,siteCollection&$top=100").catch(() => []),
    collectPages<GraphSite>(graph, "/sites/root/sites?$select=id,displayName,name,webUrl,siteCollection&$top=100").catch(() => []),
    discoverGroupSites(graph),
  ]);
  sites.push(...allSites, ...searchedSites, ...rootSubsites, ...groupSites);
  return [...new Map(sites.filter((site) => site.id && !site.isPersonalSite).map((site) => [site.id, site])).values()]
    .map((site) => ({
      id: site.id,
      name: site.displayName ?? site.name ?? site.id,
      webUrl: site.webUrl ?? null,
      hostname: site.siteCollection?.hostname ?? site.siteCollection?.hostName ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function connectedTenantGraph(
  store: MicrosoftOnboardingStore,
  tenantId: string,
): Promise<{ graph: GraphClient; token: string }> {
  requireProductionMode("Connected tenant scanning");
  requireProductionEnvironment(["DATABASE_URL", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
  const connection = await store.getInternal(tenantId);
  if (!connection || !["connected", "credential_expiring_soon"].includes(connection.status)) {
    throw new Error("A connected Microsoft 365 tenant connector is required before scanning.");
  }
  if (!connection.clientId || !connection.encryptedClientSecret) {
    throw new Error("The connected tenant does not have a usable connector credential.");
  }
  let token: string;
  try {
    token = await requestConnectorToken(tenantId, connection.clientId, decryptSecret(connection.encryptedClientSecret));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connector token acquisition failed.";
    await store.updateStatus(tenantId, "failed", "The stored remediation connector could not authenticate.", message);
    await store.audit("connector_authentication", tenantId, "failed", { message });
    throw new Error(`The stored remediation connector could not authenticate. Reauthorize an administrator and provision a replacement connector. ${message}`);
  }
  return { graph: new HttpGraphClient(token), token };
}

export async function ingestConnectedSites(
  graph: GraphClient,
  token: string,
  tenantId: string,
  siteIds: string[],
  onProgress?: (progress: ConnectedSiteScanProgress) => void,
) {
  onProgress?.({
    stage: "syncing_directory",
    currentSiteId: null,
    completedSites: 0,
    successfulSites: 0,
    failedSites: 0,
    nodes: 0,
    permissions: 0,
    failures: [],
  });
  const directory = await ingestTenantDirectory(graph, tenantId);
  const results: Array<{ siteId: string; ok: boolean; nodes: number; permissions: number; error?: string }> = [];
  for (const siteId of siteIds) {
    onProgress?.({
      stage: "scanning_sites",
      currentSiteId: siteId,
      completedSites: results.length,
      successfulSites: results.filter((result) => result.ok).length,
      failedSites: results.filter((result) => !result.ok).length,
      nodes: results.reduce((total, result) => total + result.nodes, 0),
      permissions: results.reduce((total, result) => total + result.permissions, 0),
      failures: results.filter((result) => !result.ok).map((result) => ({ siteId: result.siteId, error: result.error ?? "Unknown ingestion failure." })),
      directory,
    });
    try {
      const progress = (stage: ConnectedSiteScanProgress["stage"], retryAfterMs?: number, retryAttempt?: number) => onProgress?.({
        stage,
        currentSiteId: siteId,
        completedSites: results.length,
        successfulSites: results.filter((result) => result.ok).length,
        failedSites: results.filter((result) => !result.ok).length,
        nodes: results.reduce((total, result) => total + result.nodes, 0),
        permissions: results.reduce((total, result) => total + result.permissions, 0),
        failures: results.filter((result) => !result.ok).map((result) => ({ siteId: result.siteId, error: result.error ?? "Unknown ingestion failure." })),
        retryAfterMs,
        retryAttempt,
        directory,
      });
      const result = await new GraphIngestor(
        token,
        tenantId,
        (throttle) => progress("waiting_for_graph", throttle.retryAfterMs, throttle.attempt),
        () => progress("scanning_sites"),
      ).ingestSite(siteId);
      results.push({ siteId, ok: true, ...result });
    } catch (error) {
      results.push({
        siteId,
        ok: false,
        nodes: 0,
        permissions: 0,
        error: error instanceof Error ? error.message : "Unexpected site ingestion failure.",
      });
    }
    onProgress?.({
      stage: "scanning_sites",
      currentSiteId: siteId,
      completedSites: results.length,
      successfulSites: results.filter((result) => result.ok).length,
      failedSites: results.filter((result) => !result.ok).length,
      nodes: results.reduce((total, result) => total + result.nodes, 0),
      permissions: results.reduce((total, result) => total + result.permissions, 0),
      failures: results.filter((result) => !result.ok).map((result) => ({ siteId: result.siteId, error: result.error ?? "Unknown ingestion failure." })),
      directory,
    });
  }
  return {
    tenantId,
    requestedSites: siteIds.length,
    successfulSites: results.filter((result) => result.ok).length,
    failedSites: results.filter((result) => !result.ok).length,
    nodes: results.reduce((total, result) => total + result.nodes, 0),
    permissions: results.reduce((total, result) => total + result.permissions, 0),
    failures: results.filter((result) => !result.ok).map((result) => ({ siteId: result.siteId, error: result.error ?? "Unknown ingestion failure." })),
    directory,
    results,
  };
}

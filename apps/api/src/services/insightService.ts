import { fabricIqEnabled, fabricIqRequested, isDemoMode, isProductionEnvironmentConfigured } from "../config.js";
import { demoPermissionGraphData } from "../data/demoPermissionGraph.js";
import { DisabledFabricIqAdapter, MockFabricIqAdapter, generateRiskInsights, type FabricIqAdapter } from "../insights/index.js";
import type { PermissionGraphData } from "../types/permissions.js";
import type { RiskInsight } from "../types/insights.js";
import type { Pool } from "pg";
import { loadProductionPermissionGraph } from "./permissionGraphDataService.js";

export function createFabricIqAdapter(): FabricIqAdapter {
  if (isDemoMode) return new DisabledFabricIqAdapter("Fabric IQ is never called in demo mode; local synthetic insights are active.");
  if (!fabricIqEnabled) return new DisabledFabricIqAdapter("Fabric IQ is disabled; production data is analyzed with local rules.");
  return new MockFabricIqAdapter({
    enabled: true,
    workspaceId: process.env.FABRIC_WORKSPACE_ID,
    ontologyId: process.env.FABRIC_ONTOLOGY_ID,
    lakehouseId: process.env.FABRIC_LAKEHOUSE_ID,
    tenantId: process.env.FABRIC_TENANT_ID,
    clientId: process.env.FABRIC_CLIENT_ID,
  });
}

export async function generateInsightsForGraph(graphData: PermissionGraphData, adapter = createFabricIqAdapter()): Promise<RiskInsight[]> {
  const localInsights = generateRiskInsights(graphData);
  if (!fabricIqEnabled || !adapter.isConfigured()) return localInsights;
  try {
    await adapter.exportPermissionGraph(graphData);
    return await adapter.enrichInsights(localInsights);
  } catch (error) {
    console.warn("Fabric IQ enrichment failed; returning local deterministic insights.", error);
    return localInsights;
  }
}

export async function getDemoInsights() {
  return generateInsightsForGraph(demoPermissionGraphData);
}

export async function getInsightsForTenant(pool: Pool, tenantId: string) {
  return generateInsightsForGraph(await loadProductionPermissionGraph(pool, tenantId));
}

export async function getFabricIqStatus() {
  const adapter = createFabricIqAdapter();
  const status = await adapter.getIntegrationStatus();
  return {
    ...status,
    requested: fabricIqRequested,
    requiredConfigurationPresent: ["FABRIC_WORKSPACE_ID", "FABRIC_ONTOLOGY_ID", "FABRIC_LAKEHOUSE_ID"].every(isProductionEnvironmentConfigured),
  };
}

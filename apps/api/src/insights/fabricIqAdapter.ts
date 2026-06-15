import type { PermissionGraphData } from "../types/permissions.js";
import type { RiskInsight } from "../types/insights.js";

export interface FabricIqConfig {
  enabled: boolean;
  workspaceId?: string;
  ontologyId?: string;
  lakehouseId?: string;
  tenantId?: string;
  clientId?: string;
}

export interface FabricIqAdapter {
  isConfigured(): boolean;
  exportPermissionGraph(graphData: PermissionGraphData): Promise<void>;
  enrichInsights(localInsights: RiskInsight[]): Promise<RiskInsight[]>;
  getIntegrationStatus(): Promise<{ enabled: boolean; configured: boolean; mode: "disabled" | "mock" | "fabric"; message: string }>;
}

export class DisabledFabricIqAdapter implements FabricIqAdapter {
  constructor(private readonly message = "Fabric IQ enrichment is disabled; local rules remain active.") {}
  isConfigured() { return false; }
  async exportPermissionGraph(_graphData: PermissionGraphData) {}
  async enrichInsights(localInsights: RiskInsight[]) { return localInsights; }
  async getIntegrationStatus() { return { enabled: false, configured: false, mode: "disabled" as const, message: this.message }; }
}

export class MockFabricIqAdapter implements FabricIqAdapter {
  constructor(private readonly config: FabricIqConfig) {}
  isConfigured() { return Boolean(this.config.enabled && this.config.workspaceId && this.config.ontologyId && this.config.lakehouseId); }
  async exportPermissionGraph(_graphData: PermissionGraphData) {}
  async enrichInsights(localInsights: RiskInsight[]) {
    if (!this.isConfigured()) return localInsights;
    return localInsights.map((item) => ({
      ...item,
      source: "Hybrid" as const,
      evidence: {
        ...item.evidence,
        calculation: {
          ...item.evidence.calculation,
          fabricExplanation: "Mock Fabric IQ ontology enrichment confirms the local deterministic signal.",
          ontologyEntityType: item.resourcePath.endsWith("/") ? "Folder" : "Resource",
          fabricWorkspaceId: "00000000-0000-0000-0000-000000000000",
          confidenceScore: 0.92,
        },
      },
    }));
  }
  async getIntegrationStatus() {
    return {
      enabled: this.config.enabled,
      configured: this.isConfigured(),
      mode: "mock" as const,
      message: this.isConfigured() ? "Mock Fabric IQ enrichment is available." : "Fabric IQ is enabled but configuration is incomplete; local rules remain active.",
    };
  }
}

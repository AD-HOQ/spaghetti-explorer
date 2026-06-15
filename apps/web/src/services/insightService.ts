import type { RiskInsight } from "../types";

export async function fetchRiskInsights(tenantId?: string): Promise<RiskInsight[]> {
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const response = await fetch(`/api/insights${query}`);
  if (!response.ok) throw new Error(`Unable to load insights (${response.status}).`);
  const result = await response.json() as { insights?: RiskInsight[] };
  return Array.isArray(result.insights) ? result.insights : [];
}

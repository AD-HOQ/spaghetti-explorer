import type { RiskSeverity } from "../types/insights.js";

export const severityRank: Record<RiskSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

export function isSensitive(label?: string) {
  return label === "Confidential" || label === "Highly Confidential";
}

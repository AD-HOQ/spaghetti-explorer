export type RiskSeverity = "Low" | "Medium" | "High" | "Critical";

export type RiskInsightType =
  | "DormantBroadExposure"
  | "AnonymousSensitiveLink"
  | "BrokenInheritanceHighRisk"
  | "OwnerlessSite"
  | "InactiveSiteBroadAccess"
  | "ExternalSharingOnSensitiveContent"
  | "LargeGroupAccessToSensitiveContent"
  | "CopilotExposureRisk";

export interface RiskInsightEvidence {
  resourceId: string;
  nodeId: string;
  principalIds?: string[];
  grantIds?: string[];
  lastAccessedDate?: string;
  daysSinceLastAccess?: number;
  exposure?: string;
  sensitivityLabel?: string;
  inheritedFromResourceId?: string;
  calculation?: Record<string, unknown>;
}

export interface RiskInsight {
  id: string;
  type: RiskInsightType;
  severity: RiskSeverity;
  title: string;
  summary: string;
  resourceId: string;
  nodeIdToOpen: string;
  resourceName: string;
  resourcePath: string;
  evidence: RiskInsightEvidence;
  recommendedAction: string;
  status: "Open" | "Acknowledged" | "Remediated" | "Dismissed";
  createdAt: string;
  source: "LocalRules" | "FabricIQ" | "Hybrid";
}

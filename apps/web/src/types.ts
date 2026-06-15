export type Principal = {
  id: string;
  displayName: string;
  email: string | null;
  principalType: string;
  jobTitle?: string | null;
  manager?: string | null;
  directReports?: string[];
  description?: string | null;
  imageUrl?: string | null;
  groupType?: "domain" | "m365" | "security" | null;
  memberships?: Array<{
    id: string;
    displayName: string;
    groupType: "domain" | "m365" | "security";
  }>;
  members?: Array<{
    id: string;
    displayName: string;
    email?: string | null;
  }>;
};

export type GrantMethodType =
  | "direct"
  | "sharing_link"
  | "security_group"
  | "m365_group"
  | "inherited"
  | "role";

export type PermissionLevel = "Read" | "Edit" | "Contribute" | "Design" | "Full Control";

export type GrantMethod = {
  type: GrantMethodType;
  label: string;
  grantedByPrincipalId?: string | null;
  grantedByPrincipalType?: string | null;
  grantedBy: string | null;
  permissionLevel: PermissionLevel;
};

export type AccessiblePrincipal = {
  id: string;
  displayName: string;
  principalType: string;
  email: string | null;
  accessGrants: Array<{
    accessPath: GrantMethodType;
    label: string;
    grantedByPrincipalId: string | null;
    grantedByPrincipalType?: string | null;
    grantedBy: string | null;
    permissionLevel: PermissionLevel;
    inherited: boolean;
  }>;
};

export type DocumentNode = {
  id: string;
  parentId: string | null;
  nodeType: "site" | "library" | "folder" | "document";
  name: string;
  path: string | null;
  depth: number;
  sizeBytes: number;
  hasAccess: boolean;
  accessDetails: {
    selectedPrincipal: string | null;
    permissions: string[];
    grantedBy: string | null;
    accessMethod: string;
    sourceNode: string | null;
    inherited: boolean;
    reason: string;
    grantMethods: GrantMethod[];
    grantMethodCount: number;
    accessiblePrincipals: AccessiblePrincipal[];
  };
};

export type Relationship = {
  id: string;
  source: string;
  target: string;
  relationship: string;
  details: string;
};

export type GraphPayload = { nodes: DocumentNode[]; edges: Relationship[] };

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

export type RiskInsight = {
  id: string;
  type: RiskInsightType;
  severity: RiskSeverity;
  title: string;
  summary: string;
  resourceId: string;
  nodeIdToOpen: string;
  resourceName: string;
  resourcePath: string;
  evidence: {
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
  };
  recommendedAction: string;
  status: "Open" | "Acknowledged" | "Remediated" | "Dismissed";
  createdAt: string;
  source: "LocalRules" | "FabricIQ" | "Hybrid";
};

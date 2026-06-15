import { createHash } from "node:crypto";
import { daysSince, isBroadPrincipal, latestActivityDays } from "./anomalyRules.js";
import { isSensitive, severityRank } from "./severity.js";
import type { PermissionGraphData, PermissionGrant, PermissionPrincipal, PermissionResource } from "../types/permissions.js";
import type { RiskInsight, RiskInsightType, RiskSeverity } from "../types/insights.js";

export interface AnomalyEngineOptions {
  now?: Date;
  dormantDaysThreshold?: number;
  largeGroupThreshold?: number;
  directGrantThreshold?: number;
}

const recommendations: Record<RiskInsightType, string> = {
  DormantBroadExposure: "Review inherited permissions, remove broad sharing, or archive/restrict the file before Copilot rollout.",
  AnonymousSensitiveLink: "Remove the anonymous sharing link and replace it with named access.",
  BrokenInheritanceHighRisk: "Review direct grants and restore inheritance where appropriate.",
  OwnerlessSite: "Assign accountable site owners and review broad or external access.",
  InactiveSiteBroadAccess: "Archive the inactive site or restrict its broad access.",
  ExternalSharingOnSensitiveContent: "Validate the external business need and remove unnecessary external access.",
  LargeGroupAccessToSensitiveContent: "Reduce group membership or replace the broad group grant with least-privilege access.",
  CopilotExposureRisk: "Restrict broad access before allowing this content to remain indexed by Copilot.",
};

function stableId(type: RiskInsightType, resourceId: string, evidenceIds: string[]) {
  return `risk-${createHash("sha256").update(`${type}:${resourceId}:${[...evidenceIds].sort().join(",")}`).digest("hex").slice(0, 16)}`;
}

function insight(
  type: RiskInsightType,
  severity: RiskSeverity,
  title: string,
  summary: string,
  resource: PermissionResource,
  evidence: RiskInsight["evidence"],
  now: Date,
): RiskInsight {
  return {
    id: stableId(type, resource.id, [...(evidence.grantIds ?? []), ...(evidence.principalIds ?? [])]),
    type,
    severity,
    title,
    summary,
    resourceId: resource.id,
    nodeIdToOpen: resource.nodeId,
    resourceName: resource.name,
    resourcePath: resource.path,
    evidence,
    recommendedAction: recommendations[type],
    status: "Open",
    createdAt: now.toISOString(),
    source: "LocalRules",
  };
}

export function generateRiskInsights(graphData: PermissionGraphData, options: AnomalyEngineOptions = {}): RiskInsight[] {
  const now = options.now ?? new Date();
  const dormantDaysThreshold = options.dormantDaysThreshold ?? 1095;
  const largeGroupThreshold = options.largeGroupThreshold ?? 100;
  const directGrantThreshold = options.directGrantThreshold ?? 10;
  const principals = new Map(graphData.principals.map((principal) => [principal.id, principal]));
  const grantsByResource = new Map<string, PermissionGrant[]>();
  graphData.grants.forEach((grant) => grantsByResource.set(grant.resourceId, [...(grantsByResource.get(grant.resourceId) ?? []), grant]));
  const results: RiskInsight[] = [];

  for (const resource of graphData.resources) {
    const grants = grantsByResource.get(resource.id) ?? [];
    const grantPrincipals = grants.map((grant) => ({ grant, principal: principals.get(grant.principalId) })).filter((item): item is { grant: PermissionGrant; principal: PermissionPrincipal } => Boolean(item.principal));
    const broad = grantPrincipals.filter(({ grant, principal }) => isBroadPrincipal(principal, grant));
    const external = grantPrincipals.filter(({ principal }) => principal.isExternal);
    const largeGroups = grantPrincipals.filter(({ principal }) => principal.principalType === "Group" && (principal.memberCount ?? 0) >= largeGroupThreshold);
    const direct = grantPrincipals.filter(({ grant }) => grant.grantType === "Direct");
    const anonymous = grantPrincipals.filter(({ grant, principal }) => grant.linkType === "Anonymous" || principal.principalType === "AnonymousLink");
    const dormantDays = daysSince(resource.lastAccessedDate, now);
    const activityDays = latestActivityDays(resource, now);
    const evidence = (items: typeof grantPrincipals, extra: Partial<RiskInsight["evidence"]> = {}): RiskInsight["evidence"] => ({
      resourceId: resource.id,
      nodeId: resource.nodeId,
      principalIds: [...new Set(items.map(({ principal }) => principal.id))],
      grantIds: [...new Set(items.map(({ grant }) => grant.id))],
      sensitivityLabel: resource.sensitivityLabel,
      ...extra,
    });

    if (resource.resourceType === "File" && dormantDays !== undefined && dormantDays >= dormantDaysThreshold && broad.length) {
      const severity: RiskSeverity = anonymous.length || resource.sensitivityLabel === "Highly Confidential" ? "Critical" : broad.some(({ principal }) => principal.principalType === "EveryoneExceptExternalUsers") || resource.sensitivityLabel === "Confidential" ? "High" : "Medium";
      results.push(insight("DormantBroadExposure", severity, "Dormant file broadly shared", `${resource.name} has not been accessed for ${dormantDays} days and remains broadly exposed.`, resource, evidence(broad, { lastAccessedDate: resource.lastAccessedDate, daysSinceLastAccess: dormantDays, exposure: broad.map(({ principal }) => principal.displayName).join(", "), calculation: { dormantDaysThreshold } }), now));
    }
    if (isSensitive(resource.sensitivityLabel) && anonymous.length) {
      results.push(insight("AnonymousSensitiveLink", "Critical", "Anonymous link on sensitive content", `${resource.name} is ${resource.sensitivityLabel} and can be opened through an anonymous link.`, resource, evidence(anonymous, { exposure: "Anonymous link" }), now));
    }
    if ((resource.resourceType === "Folder" || resource.resourceType === "File") && direct.length >= directGrantThreshold) {
      results.push(insight("BrokenInheritanceHighRisk", isSensitive(resource.sensitivityLabel) ? "High" : "Medium", "Broken inheritance with many principals", `${resource.name} has ${direct.length} direct permission grants.`, resource, evidence(direct, { calculation: { directPrincipalCount: direct.length, directGrantThreshold } }), now));
    }
    if (resource.resourceType === "Site" && !(resource.ownerIds?.length) && (broad.length || external.length)) {
      results.push(insight("OwnerlessSite", "High", "Ownerless site with broad access", `${resource.name} has broad or external access but no recorded owner.`, resource, evidence([...broad, ...external]), now));
    }
    if (resource.resourceType === "Site" && activityDays !== undefined && activityDays >= 365 && broad.length) {
      const severity: RiskSeverity = anonymous.length || broad.some(({ principal }) => principal.principalType === "Everyone") ? "High" : "Medium";
      results.push(insight("InactiveSiteBroadAccess", severity, "Inactive site with broad access", `${resource.name} has been inactive for ${activityDays} days and remains broadly accessible.`, resource, evidence(broad, { daysSinceLastAccess: activityDays, exposure: broad.map(({ principal }) => principal.displayName).join(", "), calculation: { inactiveDaysThreshold: 365 } }), now));
    }
    if (isSensitive(resource.sensitivityLabel) && external.length) {
      results.push(insight("ExternalSharingOnSensitiveContent", "High", "External sharing on sensitive content", `${resource.name} is ${resource.sensitivityLabel} and is shared with an external principal.`, resource, evidence(external), now));
    }
    if (isSensitive(resource.sensitivityLabel) && largeGroups.length) {
      results.push(insight("LargeGroupAccessToSensitiveContent", "High", "Large group access to sensitive content", `${resource.name} is accessible to a group with at least ${largeGroupThreshold} members.`, resource, evidence(largeGroups, { calculation: { largeGroupThreshold, memberCounts: largeGroups.map(({ principal }) => principal.memberCount) } }), now));
    }
    if (resource.isIndexedByCopilot && resource.sensitivityLabel !== "Public" && broad.length) {
      results.push(insight("CopilotExposureRisk", resource.sensitivityLabel === "Highly Confidential" ? "Critical" : "High", "Copilot exposure risk", `${resource.name} is indexed by Copilot while broadly exposed.`, resource, evidence(broad, { exposure: broad.map(({ principal }) => principal.displayName).join(", ") }), now));
    }
  }

  const unique = new Map(results.map((item) => [item.id, item]));
  return [...unique.values()].sort((left, right) =>
    severityRank[right.severity] - severityRank[left.severity]
    || (right.evidence.daysSinceLastAccess ?? 0) - (left.evidence.daysSinceLastAccess ?? 0)
    || left.resourceName.localeCompare(right.resourceName),
  );
}

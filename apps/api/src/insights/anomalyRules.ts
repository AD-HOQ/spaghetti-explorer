import type { PermissionGrant, PermissionPrincipal, PermissionResource } from "../types/permissions.js";

export const broadPrincipalTypes = new Set([
  "Everyone",
  "EveryoneExceptExternalUsers",
  "AnonymousLink",
  "OrganizationLink",
]);

export function isBroadPrincipal(principal: PermissionPrincipal, grant?: PermissionGrant) {
  return broadPrincipalTypes.has(principal.principalType)
    || principal.displayName.toLowerCase() === "all employees"
    || grant?.linkType === "Anonymous"
    || grant?.linkType === "Organization";
}

export function daysSince(date: string | undefined, now: Date) {
  if (!date) return undefined;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return undefined;
  return Math.floor((now.getTime() - value.getTime()) / 86_400_000);
}

export function latestActivityDays(resource: PermissionResource, now: Date) {
  const values = [daysSince(resource.lastAccessedDate, now), daysSince(resource.lastModifiedDate, now)]
    .filter((value): value is number => value !== undefined);
  return values.length ? Math.min(...values) : undefined;
}

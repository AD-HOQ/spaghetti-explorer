import type { PermissionGraphData, PermissionGrant, PermissionPrincipal } from "../types/permissions.js";

const everyone: PermissionPrincipal = { id: "principal-everyone-external", displayName: "Everyone Except External Users", principalType: "EveryoneExceptExternalUsers", memberCount: 1200 };
const anonymous: PermissionPrincipal = { id: "principal-anonymous", displayName: "Anyone with the link", principalType: "AnonymousLink" };
const organization: PermissionPrincipal = { id: "principal-organization", displayName: "Organization-wide link", principalType: "OrganizationLink", memberCount: 1200 };
const external: PermissionPrincipal = { id: "principal-external-demo", displayName: "Riley Demo Guest", principalType: "User", email: "riley.external@contoso-demo.com", isExternal: true, isActive: true };
const largeGroup: PermissionPrincipal = { id: "principal-large-group", displayName: "Contoso Demo All Employees", principalType: "Group", memberCount: 1200, isActive: true };
const directUsers: PermissionPrincipal[] = Array.from({ length: 10 }, (_, index) => ({
  id: `principal-direct-${index + 1}`,
  displayName: `Demo Reviewer ${index + 1}`,
  principalType: "User",
  email: `reviewer-${index + 1}@contoso-demo.com`,
  isActive: true,
}));

const directGrants: PermissionGrant[] = directUsers.map((principal, index) => ({
  id: `grant-direct-${index + 1}`,
  resourceId: "resource-legal-ma",
  principalId: principal.id,
  role: "Edit",
  grantType: "Direct",
}));

export const demoPermissionGraphData: PermissionGraphData = {
  resources: [
    { id: "resource-compensation-2021", nodeId: "file-compensation-2021", resourceType: "File", name: "Compensation_2021.xlsx", path: "/Finance/Archive/Compensation_2021.xlsx", sensitivityLabel: "Highly Confidential", lastAccessedDate: "2021-01-10T00:00:00.000Z", lastModifiedDate: "2021-01-10T00:00:00.000Z", isIndexedByCopilot: true },
    { id: "resource-legal-ma", nodeId: "folder-legal-ma", resourceType: "Folder", name: "M&A Planning", path: "/Legal/M&A Planning", sensitivityLabel: "Confidential", lastAccessedDate: "2026-01-10T00:00:00.000Z", isIndexedByCopilot: true },
    { id: "resource-legacy-site", nodeId: "site-legacy-projects", resourceType: "Site", name: "Legacy Projects", path: "/sites/legacy-projects", lastAccessedDate: "2023-01-01T00:00:00.000Z", lastModifiedDate: "2023-03-01T00:00:00.000Z", ownerIds: [], sensitivityLabel: "General", isIndexedByCopilot: true },
    { id: "resource-board-pack", nodeId: "file-board-pack", resourceType: "File", name: "Board Pack.pdf", path: "/Leadership Center/Board Materials/Meetings/June 2026/Board Pack.pdf", sensitivityLabel: "Confidential", lastAccessedDate: "2026-05-01T00:00:00.000Z", ownerIds: ["principal-owner-demo"] },
  ],
  principals: [everyone, anonymous, organization, external, largeGroup, ...directUsers],
  grants: [
    { id: "grant-compensation-broad", resourceId: "resource-compensation-2021", principalId: everyone.id, role: "Read", grantType: "Inherited", inheritedFromResourceId: "resource-finance-library" },
    { id: "grant-legal-anonymous", resourceId: "resource-legal-ma", principalId: anonymous.id, role: "Read", grantType: "SharingLink", linkType: "Anonymous" },
    { id: "grant-legacy-broad", resourceId: "resource-legacy-site", principalId: organization.id, role: "Read", grantType: "SharingLink", linkType: "Organization" },
    { id: "grant-board-external", resourceId: "resource-board-pack", principalId: external.id, role: "Read", grantType: "Direct" },
    { id: "grant-board-large-group", resourceId: "resource-board-pack", principalId: largeGroup.id, role: "Read", grantType: "Inherited" },
    ...directGrants,
  ],
};

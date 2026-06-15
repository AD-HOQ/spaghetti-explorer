export type PermissionResourceType = "Site" | "Library" | "Folder" | "File";
export type SensitivityLabel = "Public" | "General" | "Confidential" | "Highly Confidential";

export interface PermissionResource {
  id: string;
  nodeId: string;
  resourceType: PermissionResourceType;
  name: string;
  path: string;
  webUrl?: string;
  siteId?: string;
  driveId?: string;
  driveItemId?: string;
  parentId?: string;
  sensitivityLabel?: SensitivityLabel;
  lastAccessedDate?: string;
  lastModifiedDate?: string;
  createdDate?: string;
  ownerIds?: string[];
  isIndexedByCopilot?: boolean;
}

export interface PermissionPrincipal {
  id: string;
  displayName: string;
  principalType: "User" | "Group" | "Everyone" | "EveryoneExceptExternalUsers" | "AnonymousLink" | "OrganizationLink";
  email?: string;
  isExternal?: boolean;
  isActive?: boolean;
  memberCount?: number;
}

export interface PermissionGrant {
  id: string;
  resourceId: string;
  principalId: string;
  role: "Read" | "Edit" | "Owner" | "FullControl" | "LimitedAccess" | "Unknown";
  grantType: "Direct" | "Inherited" | "SharingLink";
  inheritedFromResourceId?: string;
  linkType?: "Anonymous" | "Organization" | "SpecificPeople";
  createdDate?: string;
  lastUsedDate?: string;
}

export interface PermissionGraphData {
  resources: PermissionResource[];
  principals: PermissionPrincipal[];
  grants: PermissionGrant[];
}

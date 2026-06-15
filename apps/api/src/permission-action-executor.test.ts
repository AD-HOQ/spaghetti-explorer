import assert from "node:assert/strict";
import test from "node:test";
import { encodeSharingUrl, findPermissionForPrincipal, graphRoleForPermissionLevel, parseDriveResource, sharingLinkPayload } from "./permission-action-executor.js";

test("resolves ingested drive and drive-item source identifiers", () => {
  assert.deepEqual(parseDriveResource("drive:drive-one"), { driveId: "drive-one", itemId: "root", itemPath: "root", isRoot: true });
  assert.deepEqual(parseDriveResource("driveItem:drive-one:item-one"), { driveId: "drive-one", itemId: "item-one", itemPath: "items/item-one", isRoot: false });
  assert.throws(() => parseDriveResource("site:site-one"), /Site-level permission remediation is not supported/);
});

test("finds the matching direct permission by principal object ID", () => {
  const permission = findPermissionForPrincipal([
    { id: "permission-other", grantedToV2: { user: { id: "user-other" } } },
    { id: "permission-target", grantedToV2: { group: { id: "group-target" } } },
  ], { externalId: "group-target", email: null }, "security_group");
  assert.equal(permission?.id, "permission-target");
});

test("requires a sharing-link permission when revoking sharing-link access", () => {
  const permission = findPermissionForPrincipal([
    { id: "direct", grantedToV2: { user: { id: "user-target" } } },
    { id: "link", link: {}, grantedToIdentitiesV2: [{ user: { id: "user-target" } }] },
  ], { externalId: "user-target", email: null }, "sharing_link");
  assert.equal(permission?.id, "link");
});

test("maps supported permission levels to Microsoft Graph invite roles", () => {
  assert.equal(graphRoleForPermissionLevel("Read"), "read");
  assert.equal(graphRoleForPermissionLevel("Contribute"), "write");
  assert.throws(() => graphRoleForPermissionLevel("Edit"), /SharePoint REST connector/);
  assert.throws(() => graphRoleForPermissionLevel("Design"), /SharePoint REST connector/);
  assert.throws(() => graphRoleForPermissionLevel("Full Control"), /SharePoint REST connector/);
});

test("builds explicit Microsoft Graph sharing-link payloads", () => {
  assert.deepEqual(sharingLinkPayload({ sharingLinkType: "edit", sharingLinkScope: "organization" }), {
    type: "edit",
    scope: "organization",
    retainInheritedPermissions: true,
  });
  assert.deepEqual(sharingLinkPayload({}), {
    type: "view",
    scope: "users",
    retainInheritedPermissions: true,
  });
});

test("encodes sharing URLs for Microsoft Graph permission grants", () => {
  assert.equal(
    encodeSharingUrl("https://sharepoint-demo.invalid/:f:/g/teams/demo/Example Folder"),
    "u!aHR0cHM6Ly9zaGFyZXBvaW50LWRlbW8uaW52YWxpZC86ZjovZy90ZWFtcy9kZW1vL0V4YW1wbGUgRm9sZGVy",
  );
});

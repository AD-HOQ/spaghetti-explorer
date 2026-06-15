# Fabric IQ Integration Guide

## Current implementation

Spaghetti has a provider-neutral anomaly pipeline:

`PermissionGraphData -> local deterministic rules -> RiskInsight records -> insight cards -> existing graph focus/detail behavior`

The API exposes insights at `/api/insights` and Fabric status at `/api/integrations/fabric-iq/status`. The current Fabric adapter is a safe stub because Fabric IQ is a preview capability and this repository does not assume a local SDK or undocumented REST contract.

## Local anomaly engine

The local engine runs eight deterministic permission-risk rules. It requires only normalized resources, principals, and grants. It produces stable IDs, evidence, recommended actions, node IDs, and severity-sorted cards.

Default thresholds:

- Dormant content: 1,095 days
- Large group: 100 members
- Broken inheritance/direct grants: 10 principals

The engine works without Microsoft Graph, SharePoint, Purview, Fabric, or a database.

## Demo mode

Set `APP_MODE=demo` and `FABRIC_IQ_ENABLED=false`. Demo mode uses only synthetic data and forcibly disables Fabric calls even if `FABRIC_IQ_ENABLED=true` is accidentally supplied.

## Production architecture

In production, normalize ingested SharePoint permission data into `PermissionGraphData`, run local rules, and optionally export/enrich through the configured Fabric adapter. If Fabric is unavailable or misconfigured, return local insights rather than failing the app.

## Fabric IQ prerequisites

Provision or obtain access to:

1. A paid Microsoft Fabric capacity that supports the required preview capabilities. Fabric data agents currently document F2 or higher (or P1+ with Fabric enabled) as a prerequisite.
2. A Fabric workspace assigned to that capacity.
3. A lakehouse in the workspace.
4. Fabric IQ/ontology preview access enabled for the tenant and workspace.
5. The Fabric Graph tenant setting enabled because ontology graph functionality depends on it.
6. Permission to create ontology entities, relationships, bindings, and data agents.
7. An Entra application or managed identity only when the eventual authenticated REST integration is implemented.

Because Fabric IQ is preview, exact portal names and availability may change. Confirm current prerequisites with Microsoft before production use.

Official references:

- [What is Fabric IQ?](https://learn.microsoft.com/en-us/fabric/iq/overview)
- [What is ontology (preview)?](https://learn.microsoft.com/en-us/fabric/iq/ontology/overview)
- [Create a Fabric workspace](https://learn.microsoft.com/en-us/fabric/fundamentals/create-workspaces)
- [Fabric data agent concepts](https://learn.microsoft.com/en-us/fabric/data-science/concept-data-agent)
- [Microsoft Fabric REST API references](https://learn.microsoft.com/en-us/rest/api/fabric/articles/)

## Environment variables

Use local environment variables only:

```text
APP_MODE=production
FABRIC_IQ_ENABLED=true
FABRIC_WORKSPACE_ID=00000000-0000-0000-0000-000000000000
FABRIC_ONTOLOGY_ID=00000000-0000-0000-0000-000000000000
FABRIC_LAKEHOUSE_ID=00000000-0000-0000-0000-000000000000
FABRIC_API_BASE_URL=https://api.fabric.microsoft.com
```

Do not put access tokens or secrets in `.env.example`.

## Lakehouse table design

Create Delta tables that mirror the normalized model:

- `permission_resources`: resource IDs, node IDs, type, path, URLs, activity dates, sensitivity, owner IDs, Copilot indexing.
- `permission_principals`: principal IDs, type, external/active flags, member counts.
- `permission_grants`: grant IDs, resource/principal IDs, role, grant type, inheritance, link type, dates.
- `risk_insights`: insight fields, status, source, timestamps.
- `risk_insight_evidence`: insight/resource/principal/grant relationships and calculations.
- `access_events`: resource/principal event time and activity type when available.

Partition tenant-scoped production tables by tenant and ingestion date. Never mix demo and production tenant records.

## Ontology design

Entity types:

`Tenant`, `Site`, `Library`, `Folder`, `File`, `Principal`, `User`, `Group`, `SharingLink`, `PermissionGrant`, `AccessEvent`, `SensitivityLabel`, `RiskInsight`

Relationships:

- Tenant CONTAINS Site
- Site CONTAINS Library
- Library CONTAINS Folder
- Folder CONTAINS Folder
- Folder CONTAINS File
- Principal HAS_PERMISSION PermissionGrant
- PermissionGrant APPLIES_TO Resource
- PermissionGrant INHERITED_FROM Resource
- File HAS_LABEL SensitivityLabel
- Principal MEMBER_OF Group
- Resource HAS_ACCESS_EVENT AccessEvent
- RiskInsight FLAGS Resource
- RiskInsight SUPPORTED_BY PermissionGrant

Mapped properties:

- Resource: `id`, `nodeId`, `resourceType`, `name`, `path`, `webUrl`, `lastAccessedDate`, `sensitivityLabel`, `isIndexedByCopilot`
- Principal: `id`, `displayName`, `principalType`, `isExternal`, `isActive`, `memberCount`
- PermissionGrant: `id`, `role`, `grantType`, `linkType`, `inheritedFromResourceId`, `createdDate`, `lastUsedDate`
- RiskInsight: `id`, `type`, `severity`, `title`, `summary`, `recommendedAction`, `status`, `source`

## Data binding approach

Bind each lakehouse table to its ontology entity using the stable ID as the entity key. Bind foreign-key columns to ontology relationships. Validate resource-to-parent and grant-to-principal/resource relationships before enabling enrichment.

## Data agent / operations agent approach

A Fabric data agent can answer permission-risk questions over ontology entities and explain supporting grants. An operations agent could later propose remediation actions, but Spaghetti should keep execution behind its existing staged action tray, explicit administrator review, and permanent audit log.

## App integration flow

1. Ingest and normalize permission graph data.
2. Run local deterministic rules.
3. Persist/export normalized tables to OneLake.
4. Ask the Fabric adapter to enrich local insights.
5. Merge enrichment by stable insight ID.
6. Return local insights if any Fabric step fails.
7. Click an insight card to reuse the existing graph focus and resource detail behavior.

## How to incorporate Fabric IQ into this app

1. In the Fabric portal, create a workspace on an eligible Fabric capacity.
2. Create a lakehouse named for the permission-risk model.
3. Create the tables listed in **Lakehouse table design**.
4. Load synthetic data first and validate IDs/relationships.
5. Enable or request Fabric IQ preview access for the tenant/workspace.
6. Create an ontology using the entities and relationships listed above.
7. Bind lakehouse tables and keys to ontology entities and relationships.
8. Record the workspace, lakehouse, and ontology IDs in a local `.env`.
9. Set `APP_MODE=production` and `FABRIC_IQ_ENABLED=true`.
10. Implement `FabricIqRestAdapter` only against Microsoft-documented authenticated APIs available to your tenant.
11. Replace the current mock adapter selection in `createFabricIqAdapter`.
12. Validate that adapter failures still return Local Rules insights.
13. Add a data agent if desired, then constrain it to read/explain insights rather than directly executing permission changes.

## Testing checklist

- All eight deterministic rules generate expected cards.
- Stable insight IDs remain stable for identical evidence.
- Every card node ID exists in the current graph.
- Clicking a card focuses the node and opens details.
- Demo mode performs no Fabric calls.
- Missing Fabric configuration returns local insights.
- Fabric failures return local insights.
- No production identifiers or exported tenant data enter source control.

## Security notes

Use managed identity or a secure server-side credential store for future Fabric authentication. Never expose tokens to the browser. Apply tenant isolation to all tables, exports, ontology queries, and insight retrieval. Keep remediation execution separate from insight generation.

## Remaining manual setup

- Confirm Fabric IQ preview availability for your tenant and region.
- Provision Fabric capacity/workspace/lakehouse.
- Create and bind ontology entities and relationships.
- Decide the supported Microsoft-documented authentication/API path.
- Configure workspace-level permissions and tenant isolation.
- Implement and validate the real adapter.

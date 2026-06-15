import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { appMode, isDemoMode, requireProductionEnvironment } from "./config.js";
import { databaseAvailable, pool } from "./db.js";
import { demoGraph, demoPrincipals } from "./demo.js";
import { GraphIngestor } from "./graph-ingestion.js";
import { microsoftOnboardingRouter } from "./microsoft-onboarding-routes.js";
import { PermissionActionLogStore } from "./permission-action-log-store.js";
import { PermissionActionService } from "./permission-action-service.js";
import { PermissionActionExecutor } from "./permission-action-executor.js";
import { buildPowerAutomateSolutionPackage, listPowerPlatformEnvironments, powerAutomateSolution, validatePowerAutomateSolution } from "./power-automate-integration.js";
import { getDemoInsights, getFabricIqStatus, getInsightsForTenant } from "./services/insightService.js";
import { getDemoAuditEvents } from "./services/purviewAudit.mock.js";
import { scanDemoSharePointSite } from "./services/sharePointScanner.mock.js";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/microsoft/connect", microsoftOnboardingRouter());

const tenantConnectionSchema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(20),
  applicationObjectId: z.string().uuid(),
  servicePrincipalId: z.string().uuid(),
  credentialKeyId: z.string().uuid(),
  credentialExpiresAt: z.string().datetime(),
  profile: z.enum(["discovery", "remediation"]),
  permissions: z.array(z.string().min(1)),
  configuredAt: z.string().datetime(),
});
type TenantConnection = z.infer<typeof tenantConnectionSchema>;

// This runtime store proves the setup handoff contract without persisting secrets
// to the demo database. Production deployments should replace it with Key Vault.
const tenantConnections = new Map<string, TenantConnection>();
const permissionActionLogs = new PermissionActionLogStore();
const permissionActions = new PermissionActionService(permissionActionLogs);
const permissionActionExecutor = new PermissionActionExecutor();
void permissionActionLogs.markInterruptedActions().catch((error) => console.error("Unable to reconcile interrupted permission actions.", error));
const permissionActionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum([
    "remove_security_group_permission",
    "remove_m365_group_permission",
    "remove_sharing_link_user",
    "delete_sharing_link",
    "remove_principal_from_group",
    "remove_direct_permission",
    "remove_principal_permission",
    "break_inheritance",
    "reset_inheritance",
    "add_permission_grant",
  ]),
  label: z.string().min(1),
  nodeId: z.string().min(1),
  nodeName: z.string().min(1),
  principalId: z.string().optional(),
  principalName: z.string().optional(),
  grantIndex: z.number().int().nonnegative().optional(),
  command: z.object({
    provider: z.enum(["microsoft_graph", "sharepoint_rest"]),
    operation: z.string().min(1),
    method: z.enum(["POST", "DELETE"]),
    endpointTemplate: z.string().min(1),
    accessPath: z.string().optional(),
    targetPrincipalId: z.string().optional(),
    targetPrincipalName: z.string().optional(),
    targetPrincipalType: z.string().optional(),
    sourcePrincipalId: z.string().optional(),
    sourcePrincipalName: z.string().optional(),
    permissionLevel: z.enum(["Read", "Edit", "Contribute", "Design", "Full Control"]).optional(),
    sharingLinkType: z.enum(["view", "edit"]).optional(),
    sharingLinkScope: z.enum(["users", "organization", "anonymous"]).optional(),
  }),
});

app.get("/api/health", async (_request, response) => {
  response.json({ ok: true, appMode, database: (await databaseAvailable()) ? "connected" : "demo-mode" });
});

app.get("/api/insights", async (request, response, next) => {
  try {
    const tenantId = z.string().uuid().optional().parse(request.query.tenantId);
    if (!isDemoMode && !(await databaseAvailable())) throw new Error("PostgreSQL is required while APP_MODE=production.");
    if (!isDemoMode && !tenantId) throw new Error("tenantId is required while APP_MODE=production.");
    const insights = isDemoMode ? await getDemoInsights() : await getInsightsForTenant(pool, tenantId!);
    response.json({ mode: appMode, fabric: await getFabricIqStatus(), insights });
  } catch (error) {
    next(error);
  }
});
app.get("/api/demo/risk-insights", async (_request, response, next) => {
  try {
    response.json({ mode: appMode, insights: await getDemoInsights() });
  } catch (error) {
    next(error);
  }
});
app.get("/api/integrations/fabric-iq/status", async (_request, response, next) => {
  try {
    response.json(await getFabricIqStatus());
  } catch (error) {
    next(error);
  }
});
app.get("/api/demo/purview-audit", (_request, response) => response.json({ mode: appMode, events: getDemoAuditEvents() }));

app.get("/api/integrations/power-automate/environments", (_request, response) => {
  response.json({ environments: listPowerPlatformEnvironments(), solution: powerAutomateSolution });
});

app.get("/api/integrations/power-automate/solution", (_request, response) => {
  response
    .attachment(`Spaghetti_Approval_Flows_${powerAutomateSolution.version}.zip`)
    .type("application/zip")
    .send(buildPowerAutomateSolutionPackage());
});

app.post("/api/integrations/power-automate/validate", async (request, response, next) => {
  try {
    const body = z.object({ environmentId: z.string().min(1) }).parse(request.body);
    response.json(await validatePowerAutomateSolution(body.environmentId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/setup/handoff", (request, response, next) => {
  try {
    requireProductionEnvironment(["SETUP_HANDOFF_TOKEN"]);
    const expectedToken = process.env.SETUP_HANDOFF_TOKEN;
    if (!expectedToken) {
      return response.status(503).json({ error: "SETUP_HANDOFF_TOKEN is not configured." });
    }
    if (request.header("X-Spaghetti-Setup-Token") !== expectedToken) {
      return response.status(401).json({ error: "Invalid setup handoff token." });
    }

    const connection = tenantConnectionSchema.parse(request.body);
    tenantConnections.set(connection.tenantId, connection);
    return response.status(202).json({
      ok: true,
      tenantId: connection.tenantId,
      clientId: connection.clientId,
      stored: "runtime-vault",
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/setup/connections", (_request, response) => {
  response.json([...tenantConnections.values()].map(({ clientSecret: _clientSecret, ...connection }) => connection));
});

app.get("/api/principals", async (request, response, next) => {
  try {
    const tenantId = z.string().uuid().optional().parse(request.query.tenantId);
    if (isDemoMode) return response.json(demoPrincipals);
    if (!(await databaseAvailable())) throw new Error("PostgreSQL is required while APP_MODE=production.");
    if (!tenantId) throw new Error("tenantId is required while APP_MODE=production.");
    const result = await pool.query(
      `SELECT p.id, p.display_name AS "displayName", p.email, p.principal_type AS "principalType",
        p.job_title AS "jobTitle", null::varchar AS manager, ARRAY[]::varchar[] AS "directReports",
        p.description, p.group_type AS "groupType",
        COALESCE((
          SELECT json_agg(json_build_object('id', parent.id, 'displayName', parent.display_name, 'groupType', parent.group_type)
            ORDER BY parent.display_name)
          FROM principal_memberships pm JOIN principals parent ON parent.id = pm.parent_principal_id
          WHERE pm.tenant_id = p.tenant_id AND pm.child_principal_id = p.id
        ), '[]'::json) AS memberships,
        COALESCE((
          SELECT json_agg(json_build_object('id', child.id, 'displayName', child.display_name, 'email', child.email)
            ORDER BY child.display_name)
          FROM principal_memberships pm JOIN principals child ON child.id = pm.child_principal_id
          WHERE pm.tenant_id = p.tenant_id AND pm.parent_principal_id = p.id
        ), '[]'::json) AS members
       FROM principals p WHERE p.tenant_id = $1 AND p.principal_type IN ('user', 'guest', 'group') AND p.is_active = true
       ORDER BY display_name`,
      [tenantId],
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/graph", async (request, response, next) => {
  try {
    const query = z.object({
      tenantId: z.string().uuid().optional(),
      principalId: z.string().uuid().optional(),
      siteId: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    }).parse(request.query);
    if (isDemoMode) return response.json(demoGraph(query.principalId));
    if (!(await databaseAvailable())) throw new Error("PostgreSQL is required while APP_MODE=production.");
    if (!query.tenantId) throw new Error("tenantId is required while APP_MODE=production.");
    const scopedSiteIds = Array.isArray(query.siteId) ? query.siteId : query.siteId ? [query.siteId] : [];
    const result = await pool.query(
      `SELECT n.id, n.parent_id AS "parentId", n.node_type AS "nodeType", n.name, n.path, n.depth, 0 AS "sizeBytes",
        CASE WHEN $2::uuid IS NULL THEN true ELSE coalesce(e.has_access, false) END AS "hasAccess",
        e.can_read AS "canRead", e.can_write AS "canWrite", e.can_delete AS "canDelete",
        e.can_share AS "canShare", e.is_owner AS "isOwner",
        e.access_source_summary AS "accessSourceSummary"
       FROM document_nodes n
       LEFT JOIN effective_access_cache e
         ON e.node_id = n.id AND e.principal_id = $2::uuid AND e.tenant_id = n.tenant_id
       WHERE n.tenant_id = $1
         AND (
           cardinality($3::text[]) = 0
           OR n.id IN (
             SELECT c.descendant_node_id
             FROM document_nodes site
             JOIN document_node_closure c ON c.ancestor_node_id = site.id
             WHERE site.tenant_id = $1
               AND site.node_type = 'site'
               AND site.source_id = ANY($3::text[])
           )
         )
       ORDER BY n.depth, n.name`,
      [query.tenantId, query.principalId ?? null, scopedSiteIds.map((siteId) => `site:${siteId}`)],
    );
    const selectedPrincipal = query.principalId
      ? await pool.query<{ displayName: string }>(
          `SELECT display_name AS "displayName" FROM principals WHERE tenant_id = $1 AND id = $2`,
          [query.tenantId, query.principalId],
        )
      : null;
    const selectedName = selectedPrincipal?.rows[0]?.displayName ?? null;
    const accessByNode = !query.principalId
      ? await pool.query<{
          nodeId: string;
          id: string;
          displayName: string;
          email: string | null;
          principalType: string;
          accessGrants: Array<{
            accessPath: string;
            label: string;
            grantedByPrincipalId: string | null;
            grantedByPrincipalType: string | null;
            grantedBy: string | null;
            permissionLevel: string;
            inherited: boolean;
          }>;
        }>(
          `WITH RECURSIVE membership AS (
             SELECT p.id AS selected_id, p.id AS grants_id
             FROM principals p WHERE p.tenant_id = $1
             UNION
             SELECT membership.selected_id, pm.parent_principal_id
             FROM membership
             JOIN principal_memberships pm ON pm.child_principal_id = membership.grants_id
             WHERE pm.tenant_id = $1
           )
           SELECT e.node_id AS "nodeId", selected.id, selected.display_name AS "displayName", selected.email,
            selected.principal_type AS "principalType",
            json_agg(DISTINCT jsonb_build_object(
              'accessPath', CASE
                WHEN permission.permission_source = 'sharing_link' THEN 'sharing_link'
                WHEN grantor.principal_type = 'group' AND grantor.group_type = 'm365' THEN 'm365_group'
                WHEN grantor.principal_type = 'group' THEN 'security_group'
                WHEN permission.inherit THEN 'inherited'
                ELSE 'direct'
              END,
              'label', CASE
                WHEN permission.permission_source = 'sharing_link' THEN 'Sharing link'
                WHEN grantor.principal_type = 'group' AND grantor.group_type = 'm365' THEN CASE WHEN permission.inherit THEN 'M365 group (inherited)' ELSE 'M365 group' END
                WHEN grantor.principal_type = 'group' THEN CASE WHEN permission.inherit THEN 'Security group (inherited)' ELSE 'Security group' END
                WHEN permission.inherit THEN 'Inherited permission'
                ELSE 'Direct permission'
              END,
              'grantedByPrincipalId', grantor.id,
              'grantedByPrincipalType', grantor.principal_type,
              'grantedBy', grantor.display_name,
              'permissionLevel', CASE permission.permission_type
                WHEN 'owner' THEN 'Full Control'
                WHEN 'write' THEN 'Contribute'
                ELSE 'Read'
              END,
              'inherited', permission.inherit
            )) AS "accessGrants"
           FROM effective_access_cache e
           JOIN principals selected ON selected.id = e.principal_id
           JOIN membership ON membership.selected_id = selected.id
           JOIN permissions permission ON permission.node_id = e.node_id AND permission.principal_id = membership.grants_id
           JOIN principals grantor ON grantor.id = permission.principal_id
           WHERE e.tenant_id = $1 AND e.has_access = true
           GROUP BY e.node_id, selected.id, selected.display_name, selected.email, selected.principal_type
           ORDER BY selected.display_name`,
          [query.tenantId],
        )
      : null;
    const selectedGrantsByNode = query.principalId
      ? await pool.query<{
          nodeId: string;
          type: string;
          label: string;
          grantedByPrincipalId: string;
          grantedByPrincipalType: string;
          grantedBy: string;
          permissionLevel: string;
        }>(
          `WITH RECURSIVE membership AS (
             SELECT $2::uuid AS selected_id, $2::uuid AS grants_id
             UNION
             SELECT membership.selected_id, pm.parent_principal_id
             FROM membership
             JOIN principal_memberships pm ON pm.child_principal_id = membership.grants_id
             WHERE pm.tenant_id = $1
           )
           SELECT permission.node_id AS "nodeId",
            CASE
              WHEN permission.permission_source = 'sharing_link' THEN 'sharing_link'
              WHEN grantor.principal_type = 'group' AND grantor.group_type = 'm365' THEN 'm365_group'
              WHEN grantor.principal_type = 'group' THEN 'security_group'
              WHEN permission.inherit THEN 'inherited'
              ELSE 'direct'
            END AS type,
            CASE
              WHEN permission.permission_source = 'sharing_link' THEN 'Sharing link'
              WHEN grantor.principal_type = 'group' AND grantor.group_type = 'm365' THEN CASE WHEN permission.inherit THEN 'M365 group (inherited)' ELSE 'M365 group' END
              WHEN grantor.principal_type = 'group' THEN CASE WHEN permission.inherit THEN 'Security group (inherited)' ELSE 'Security group' END
              WHEN permission.inherit THEN 'Inherited permission'
              ELSE 'Direct permission'
            END AS label,
            grantor.id AS "grantedByPrincipalId",
            grantor.principal_type AS "grantedByPrincipalType",
            grantor.display_name AS "grantedBy",
            CASE permission.permission_type
              WHEN 'owner' THEN 'Full Control'
              WHEN 'write' THEN 'Contribute'
              ELSE 'Read'
            END AS "permissionLevel"
           FROM permissions permission
           JOIN membership ON membership.grants_id = permission.principal_id
           JOIN principals grantor ON grantor.id = permission.principal_id
           WHERE permission.tenant_id = $1`,
          [query.tenantId, query.principalId],
        )
      : null;
    const accessiblePrincipalsByNode = new Map<string, typeof accessByNode extends null ? never[] : NonNullable<typeof accessByNode>["rows"]>();
    accessByNode?.rows.forEach((principal) => {
      const existing = accessiblePrincipalsByNode.get(principal.nodeId) ?? [];
      existing.push(principal);
      accessiblePrincipalsByNode.set(principal.nodeId, existing);
    });
    const selectedGrantMethodsByNode = new Map<string, NonNullable<typeof selectedGrantsByNode>["rows"]>();
    selectedGrantsByNode?.rows.forEach((grant) => {
      const existing = selectedGrantMethodsByNode.get(grant.nodeId) ?? [];
      existing.push(grant);
      selectedGrantMethodsByNode.set(grant.nodeId, existing);
    });
    const nodes = result.rows.map((node) => {
      const permissions = [
        node.canRead && "read",
        node.canWrite && "write",
        node.canDelete && "delete",
        node.canShare && "share",
        node.isOwner && "owner",
      ].filter(Boolean);
      return {
        ...node,
        accessDetails: {
          selectedPrincipal: selectedName,
          permissions,
          grantedBy: node.accessSourceSummary ?? null,
          accessMethod: !query.principalId ? "No user selected" : node.hasAccess ? "Effective permission" : "No effective grant",
          sourceNode: null,
          inherited: false,
          grantMethods: !query.principalId || !node.hasAccess
            ? []
            : selectedGrantMethodsByNode.get(node.id) ?? [
                {
                  type: node.accessSourceSummary?.toLowerCase().includes("group") ? "security_group" : "direct",
                  label: node.accessSourceSummary?.toLowerCase().includes("group") ? "Security group" : "Direct permission",
                  grantedBy: node.accessSourceSummary ?? null,
                  permissionLevel: node.isOwner ? "Full Control" : node.canWrite ? "Contribute" : "Read",
                },
              ],
          grantMethodCount: !query.principalId || !node.hasAccess ? 0 : selectedGrantMethodsByNode.get(node.id)?.length ?? 1,
          accessiblePrincipals: accessiblePrincipalsByNode.get(node.id) ?? [],
          reason: !query.principalId
            ? "Select a user to inspect how they can access this resource."
            : node.hasAccess
              ? `${selectedName ?? "Selected user"} receives access through ${node.accessSourceSummary ?? "an effective permission grant"}.`
              : `${selectedName ?? "Selected user"} has no direct, inherited, or group-based permission on this resource.`,
        },
      };
    });
    response.json({
      nodes,
      edges: nodes.filter((node) => node.parentId).map((node) => ({
        id: `${node.parentId}:${node.id}`,
        source: node.parentId,
        target: node.id,
        relationship: "contains",
        details: `${node.parentId} contains ${node.name}`,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingest/sharepoint", async (request, response, next) => {
  try {
    const body = z.object({
      tenantId: z.string().uuid(),
      siteId: z.string().min(1),
      accessToken: z.string().min(20).optional(),
    }).parse(request.body);
    if (isDemoMode) return response.status(202).json(await scanDemoSharePointSite(body.siteId));
    requireProductionEnvironment(["DATABASE_URL"]);
    if (!body.accessToken) throw new Error("A Microsoft Graph access token is required in production mode.");
    const result = await new GraphIngestor(body.accessToken, body.tenantId).ingestSite(body.siteId);
    response.status(202).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/actions/logs", async (request, response, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(5000).default(1000).parse(request.query.limit);
    response.json(await permissionActionLogs.list(limit));
  } catch (error) {
    next(error);
  }
});

app.post("/api/actions/log", async (request, response, next) => {
  try {
    const action = permissionActionSchema.parse(request.body);
    response.status(201).json(await permissionActionLogs.append(action, "loaded", "Action loaded into tray."));
  } catch (error) {
    next(error);
  }
});

app.post("/api/actions/execute", async (request, response, next) => {
  try {
    const action = permissionActionSchema.parse(request.body);
    const result = await permissionActions.execute(action, () => permissionActionExecutor.execute(action));
    response.json({
      ok: true,
      actionId: action.id,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_request, response) => response.sendFile(`${webDist}/index.html`));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(400).json({ error: error instanceof Error ? error.message : "Unexpected error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Access Graph API listening on http://localhost:${port}`));

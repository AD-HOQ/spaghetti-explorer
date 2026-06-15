import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { z } from "zod";
import { isDemoMode, isProductionEnvironmentConfigured, requireProductionEnvironment } from "./config.js";
import { connectedTenantGraph, ConnectedSiteScanProgress, discoverSharePointSites, ingestConnectedSites } from "./connected-tenant-scanner.js";
import { ingestTenantDirectory } from "./directory-ingestion.js";
import { HttpGraphClient } from "./microsoft-graph-client.js";
import { encryptSecret, MicrosoftOnboardingStore, MicrosoftTenantConnection } from "./microsoft-onboarding-store.js";
import { connectorPermissions, MicrosoftTenantProvisioning } from "./microsoft-tenant-provisioning.js";
import { demoTenantConnection } from "./services/graphClient.mock.js";
import { demoGraph } from "./demo.js";
import { scanDemoSharePointSite } from "./services/sharePointScanner.mock.js";

type AuthorizedSession = {
  tenantId: string;
  tenantDisplayName: string;
  userId: string | null;
  upn: string | null;
  accessToken: string;
  expiresAt: number;
};

const authorizedSessions = new Map<string, AuthorizedSession>();
const store = new MicrosoftOnboardingStore();
let demoConnected = true;

type TenantScanResult = {
  tenantId: string;
  requestedSites: number;
  successfulSites: number;
  failedSites: number;
  nodes: number;
  permissions: number;
  failures: Array<{ siteId: string; error: string }>;
  directory?: ConnectedSiteScanProgress["directory"];
  results: Array<{ siteId: string; ok: boolean; nodes?: number; permissions?: number; error?: string }>;
};

type TenantScanJob = {
  jobId: string;
  mode: "demo" | "production";
  tenantId: string;
  status: "running" | "completed" | "failed";
  stage: "syncing_directory" | "scanning_sites" | "waiting_for_graph" | "completed" | "failed";
  requestedSites: number;
  currentSiteId: string | null;
  completedSites: number;
  successfulSites: number;
  failedSites: number;
  nodes: number;
  permissions: number;
  failures: Array<{ siteId: string; error: string }>;
  retryAfterMs?: number;
  retryAttempt?: number;
  directory?: ConnectedSiteScanProgress["directory"];
  result?: TenantScanResult;
  error?: string;
  startedAt: string;
  updatedAt: string;
};

const tenantScanJobs = new Map<string, TenantScanJob>();

function createScanJob(mode: TenantScanJob["mode"], tenantId: string, requestedSites: number) {
  const now = new Date().toISOString();
  const job: TenantScanJob = {
    jobId: randomUUID(),
    mode,
    tenantId,
    status: "running",
    stage: "syncing_directory",
    requestedSites,
    currentSiteId: null,
    completedSites: 0,
    successfulSites: 0,
    failedSites: 0,
    nodes: 0,
    permissions: 0,
    failures: [],
    startedAt: now,
    updatedAt: now,
  };
  tenantScanJobs.set(job.jobId, job);
  return job;
}

function updateScanJob(job: TenantScanJob, progress: ConnectedSiteScanProgress) {
  Object.assign(job, progress, { updatedAt: new Date().toISOString() });
}

function publicScanJob(job: TenantScanJob) {
  return { ...job, result: job.status === "completed" ? job.result : undefined };
}

function base64Url(size: number) {
  return randomBytes(size).toString("base64url");
}

function cookieValue(request: express.Request, name: string) {
  const cookie = request.header("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

function currentSession(request: express.Request) {
  const id = cookieValue(request, "spaghetti_microsoft_onboarding");
  const session = id ? authorizedSessions.get(id) : undefined;
  if (session && session.expiresAt > Date.now()) return session;
  if (id) authorizedSessions.delete(id);
  return undefined;
}

function bootstrapConfig() {
  const clientId = process.env.MICROSOFT_BOOTSTRAP_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_BOOTSTRAP_CLIENT_SECRET;
  const authority = process.env.MICROSOFT_BOOTSTRAP_TENANT_ID ?? "organizations";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? "http://localhost:4000/api/microsoft/connect/callback";
  const scopes = (process.env.MICROSOFT_BOOTSTRAP_SCOPES
    ?? "openid,profile,offline_access,Application.ReadWrite.All,AppRoleAssignment.ReadWrite.All,Directory.Read.All")
    .split(",").map((scope) => scope.trim()).filter(Boolean)
    .map((scope) => ["openid", "profile", "offline_access"].includes(scope) ? scope : `https://graph.microsoft.com/${scope}`);
  return { clientId, clientSecret, authority, redirectUri, scopes };
}

function verifyGraphAccessToken(accessToken: string) {
  const claims = decodeJwt(accessToken);
  const audience = z.union([z.string(), z.array(z.string())]).parse(claims.aud);
  const audiences = Array.isArray(audience) ? audience : [audience];
  const graphAudiences = ["00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com"];
  if (!audiences.some((value) => graphAudiences.includes(value))) {
    throw new Error("Microsoft authorization returned a token for the wrong audience. Reconnect the tenant and approve the configured Microsoft Graph permissions.");
  }
}

function productionReadiness() {
  const connectionRequirements = [
    ["APP_MODE", process.env.APP_MODE === "production"],
    ["MICROSOFT_BOOTSTRAP_CLIENT_ID", isProductionEnvironmentConfigured("MICROSOFT_BOOTSTRAP_CLIENT_ID")],
    ["MICROSOFT_BOOTSTRAP_CLIENT_SECRET", isProductionEnvironmentConfigured("MICROSOFT_BOOTSTRAP_CLIENT_SECRET")],
    ["MICROSOFT_SECRET_ENCRYPTION_KEY", isProductionEnvironmentConfigured("MICROSOFT_SECRET_ENCRYPTION_KEY")],
    ["MICROSOFT_REDIRECT_URI", isProductionEnvironmentConfigured("MICROSOFT_REDIRECT_URI")],
  ].map(([name, configured]) => ({ name: String(name), configured: Boolean(configured) }));
  const storageRequirements = [
    ["DATABASE_URL", isProductionEnvironmentConfigured("DATABASE_URL")],
  ].map(([name, configured]) => ({ name: String(name), configured: Boolean(configured) }));
  return {
    ready: connectionRequirements.every((requirement) => requirement.configured),
    requirements: connectionRequirements,
    storageReady: storageRequirements.every((requirement) => requirement.configured),
    storageRequirements,
  };
}

function adminCallbackRedirect(response: express.Response, message: string) {
  const params = new URLSearchParams({ microsoft: "error", message });
  return response.redirect(`/admin?${params.toString()}`);
}

async function exchangeAuthorizationCode(code: string, verifier: string) {
  const config = bootstrapConfig();
  if (!config.clientId || !config.clientSecret) throw new Error("Microsoft bootstrap application credentials are not configured.");
  const response = await fetch(`https://login.microsoftonline.com/${config.authority}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
      scope: config.scopes.join(" "),
    }),
  });
  const token = await response.json() as {
    access_token?: string;
    id_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !token.access_token || !token.id_token) throw new Error(token.error_description ?? "Microsoft authorization-code exchange failed.");
  return token as Required<Pick<typeof token, "access_token" | "id_token">> & typeof token;
}

async function verifyMicrosoftIdentity(idToken: string, expectedNonce: string) {
  const config = bootstrapConfig();
  if (!config.clientId) throw new Error("Microsoft bootstrap client ID is not configured.");
  const untrusted = decodeJwt(idToken);
  const tenantId = z.string().uuid().parse(untrusted.tid);
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  const verified = await jwtVerify(idToken, jwks, { audience: config.clientId, issuer });
  if (verified.payload.nonce !== expectedNonce) throw new Error("Microsoft identity nonce validation failed.");
  return z.object({
    tid: z.string().uuid(),
    oid: z.string().uuid().optional(),
    preferred_username: z.string().optional(),
  }).parse(verified.payload);
}

export function microsoftOnboardingRouter() {
  const router = express.Router();

  router.get("/start", async (_request, response, next) => {
    try {
      if (isDemoMode) {
        demoConnected = true;
        return response.redirect("/admin?microsoft=demo");
      }
      requireProductionEnvironment(["MICROSOFT_BOOTSTRAP_CLIENT_ID", "MICROSOFT_BOOTSTRAP_CLIENT_SECRET", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
      const config = bootstrapConfig();
      if (!config.clientId || !config.clientSecret) {
        return response.status(503).json({ error: "Configure MICROSOFT_BOOTSTRAP_CLIENT_ID and MICROSOFT_BOOTSTRAP_CLIENT_SECRET." });
      }
      const state = base64Url(24);
      const nonce = base64Url(24);
      const verifier = base64Url(48);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      await store.savePending({ state, nonce, codeVerifier: verifier, createdAt: new Date().toISOString() });
      await store.audit("connect_start", null, "started");
      const authorizeUrl = new URL(`https://login.microsoftonline.com/${config.authority}/oauth2/v2.0/authorize`);
      authorizeUrl.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: config.redirectUri,
        response_mode: "query",
        scope: config.scopes.join(" "),
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return response.redirect(authorizeUrl.toString());
    } catch (error) {
      next(error);
    }
  });

  router.get("/callback", async (request, response, next) => {
    try {
      if (isDemoMode) return response.redirect("/admin?microsoft=demo");
      requireProductionEnvironment(["MICROSOFT_BOOTSTRAP_CLIENT_ID", "MICROSOFT_BOOTSTRAP_CLIENT_SECRET", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
      const query = z.object({
        code: z.string().min(10).optional(),
        state: z.string().min(10).optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      }).parse(request.query);
      if (query.error) {
        await store.audit("connect_callback", null, "cancelled", { error: query.error, message: query.error_description });
        return adminCallbackRedirect(response, query.error_description ?? "Microsoft authorization was cancelled or denied.");
      }
      if (!query.code || !query.state) {
        await store.audit("connect_callback", null, "invalid_callback", { hasCode: Boolean(query.code), hasState: Boolean(query.state) });
        return adminCallbackRedirect(response, "Microsoft sign-in was not completed. Start the connection again from the Tenant page.");
      }
      const pending = await store.consumePending(query.state);
      if (!pending) throw new Error("Microsoft onboarding state is invalid or expired.");
      const token = await exchangeAuthorizationCode(query.code, pending.codeVerifier);
      const identity = await verifyMicrosoftIdentity(token.id_token, pending.nonce);
      verifyGraphAccessToken(token.access_token);
      const graph = new HttpGraphClient(token.access_token);
      const [organization, me] = await Promise.all([
        graph.request<{ value: Array<{ id: string; displayName: string }> }>("GET", "/organization?$select=id,displayName"),
        graph.request<{ id: string; userPrincipalName?: string }>("GET", "/me?$select=id,userPrincipalName"),
      ]);
      const tenant = organization.value[0];
      if (!tenant || tenant.id !== identity.tid) throw new Error("Microsoft tenant identity validation failed.");

      const sessionId = base64Url(32);
      authorizedSessions.set(sessionId, {
        tenantId: identity.tid, tenantDisplayName: tenant.displayName, userId: identity.oid ?? me.id,
        upn: identity.preferred_username ?? me.userPrincipalName ?? null, accessToken: token.access_token,
        expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
      });
      const now = new Date().toISOString();
      await store.upsert({
        tenantId: identity.tid, tenantDisplayName: tenant.displayName, applicationObjectId: null, clientId: null,
        servicePrincipalObjectId: null, credentialKeyId: null, credentialExpiresAt: null, encryptedClientSecret: null,
        grantedPermissions: [], status: "microsoft_authorization_required", health: "Microsoft authorization complete. Ready to provision.",
        failureReason: null, createdByUserId: identity.oid ?? me.id, createdByUpn: identity.preferred_username ?? me.userPrincipalName ?? null,
        createdAt: now, updatedAt: now, lastVerifiedAt: null,
      });
      await store.audit("connect_callback", identity.tid, "authorized", { createdByUpn: identity.preferred_username ?? me.userPrincipalName });
      response.setHeader("Set-Cookie", `spaghetti_microsoft_onboarding=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(60, token.expires_in ?? 3600)}`);
      return response.redirect("/admin?microsoft=authorized");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected Microsoft callback error";
      await store.audit("connect_callback", null, "failed", { message });
      return adminCallbackRedirect(response, message);
    }
  });

  router.post("/provision", async (request, response, next) => {
    if (isDemoMode) return response.status(201).json(demoTenantConnection);
    requireProductionEnvironment(["MICROSOFT_BOOTSTRAP_CLIENT_ID", "MICROSOFT_BOOTSTRAP_CLIENT_SECRET", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
    const session = currentSession(request);
    if (!session) return response.status(401).json({ error: "Microsoft administrator authorization is required." });
    try {
      const body = z.object({ productName: z.string().min(2).max(80).default("Spaghetti"), permissions: z.array(z.string()).optional() }).parse(request.body);
      const provisioner = new MicrosoftTenantProvisioning(new HttpGraphClient(session.accessToken), async (progress) => {
        await store.updateStatus(session.tenantId, progress, progress.replaceAll("_", " "));
      });
      const result = await provisioner.provision({ tenantId: session.tenantId, productName: body.productName, permissions: body.permissions ?? connectorPermissions });
      const now = new Date().toISOString();
      const connection: MicrosoftTenantConnection = {
        tenantId: result.tenantId, tenantDisplayName: result.tenantDisplayName, applicationObjectId: result.applicationObjectId,
        clientId: result.clientId, servicePrincipalObjectId: result.servicePrincipalObjectId, credentialKeyId: result.credentialKeyId,
        credentialExpiresAt: result.credentialExpiresAt, encryptedClientSecret: encryptSecret(result.clientSecret),
        grantedPermissions: result.grantedPermissions, status: "connected", health: "Microsoft Graph app-only verification succeeded.",
        failureReason: null, createdByUserId: session.userId, createdByUpn: session.upn, createdAt: now, updatedAt: now,
        lastVerifiedAt: result.lastVerifiedAt,
      };
      await store.upsert(connection);
      await store.audit("provision", session.tenantId, "connected", { clientId: result.clientId, permissions: result.grantedPermissions });
      response.status(201).json(await store.get(session.tenantId));
    } catch (error) {
      await store.updateStatus(session.tenantId, "failed", "Provisioning failed.", error instanceof Error ? error.message : "Unexpected provisioning error");
      await store.audit("provision", session.tenantId, "failed", { message: error instanceof Error ? error.message : "Unexpected provisioning error" });
      next(error);
    }
  });

  router.get("/status", async (request, response, next) => {
    try {
      if (isDemoMode) {
        return response.json({
          appMode: "demo",
          bootstrapConfigured: true,
          administratorAuthorized: demoConnected,
          productionReadiness: productionReadiness(),
          connection: demoConnected
            ? demoTenantConnection
            : { status: "not_connected", health: "Demo tenant disconnected. No external Microsoft service was changed." },
        });
      }
      const requestedTenantId = z.string().uuid().optional().parse(request.query.tenantId);
      const session = currentSession(request);
      // A fresh browser/admin session should begin at Microsoft authorization.
      // Tenant-specific background checks may still request a known connector by ID.
      const connection = requestedTenantId || session ? await store.get(requestedTenantId ?? session?.tenantId) : null;
      const credentialExpiringSoon = connection?.status === "connected"
        && connection.credentialExpiresAt
        && new Date(connection.credentialExpiresAt).getTime() - Date.now() < 30 * 86400000;
      response.json({
        appMode: "production",
        bootstrapConfigured: isProductionEnvironmentConfigured("MICROSOFT_BOOTSTRAP_CLIENT_ID") && isProductionEnvironmentConfigured("MICROSOFT_BOOTSTRAP_CLIENT_SECRET"),
        administratorAuthorized: Boolean(session),
        productionReadiness: productionReadiness(),
        connection: credentialExpiringSoon
          ? { ...connection, status: "credential_expiring_soon", health: "Connector credential expires within 30 days." }
          : connection ?? { status: "not_connected", health: "No Microsoft 365 tenant is connected." },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/sites", async (request, response, next) => {
    try {
      if (isDemoMode) {
        if (!demoConnected) return response.status(409).json({ error: "Connect the demo tenant before discovering sites." });
        const sites = demoGraph().nodes
          .filter((node) => node.nodeType === "site")
          .map((node) => ({ id: node.id, name: node.name, webUrl: node.path ?? null, hostname: "contoso-demo.invalid" }));
        return response.json({ mode: "demo", tenantId: demoTenantConnection.tenantId, sites });
      }
      const tenantId = z.string().uuid().parse(request.query.tenantId);
      const { graph } = await connectedTenantGraph(store, tenantId);
      const sites = await discoverSharePointSites(graph);
      await store.audit("discover_sites", tenantId, "succeeded", { siteCount: sites.length });
      return response.json({ mode: "production", tenantId, sites });
    } catch (error) {
      next(error);
    }
  });

  router.post("/directory", async (request, response, next) => {
    try {
      const body = z.object({ tenantId: z.string().uuid() }).parse(request.body);
      if (isDemoMode) {
        return response.json({
          mode: "demo",
          tenantId: demoTenantConnection.tenantId,
          directory: { users: 5, guests: 4, groups: 5, memberships: 15, failedGroups: 0 },
        });
      }
      const { graph } = await connectedTenantGraph(store, body.tenantId);
      const directory = await ingestTenantDirectory(graph, body.tenantId);
      await store.audit("sync_directory", body.tenantId, directory.failedGroups ? "partial" : "succeeded", directory);
      return response.json({ mode: "production", tenantId: body.tenantId, directory });
    } catch (error) {
      next(error);
    }
  });

  router.post("/scan", async (request, response, next) => {
    try {
      const body = z.object({
        tenantId: z.string().uuid(),
        siteIds: z.array(z.string().min(1)).min(1).max(100),
      }).parse(request.body);
      if (isDemoMode) {
        if (!demoConnected) return response.status(409).json({ error: "Connect the demo tenant before scanning sites." });
        const scans = await Promise.all(body.siteIds.map((siteId) => scanDemoSharePointSite(siteId)));
        const job = createScanJob("demo", demoTenantConnection.tenantId, scans.length);
        const result: TenantScanResult = {
          tenantId: demoTenantConnection.tenantId,
          requestedSites: scans.length,
          successfulSites: scans.length,
          failedSites: 0,
          nodes: scans.reduce((total, scan) => total + scan.nodes, 0),
          permissions: scans.reduce((total, scan) => total + scan.permissions, 0),
          failures: [],
          results: scans.map((scan) => ({ siteId: scan.siteId, ok: true })),
        };
        Object.assign(job, result, {
          status: "completed",
          stage: "completed",
          completedSites: scans.length,
          currentSiteId: null,
          result,
          updatedAt: new Date().toISOString(),
        });
        return response.status(202).json(publicScanJob(job));
      }
      const { graph, token } = await connectedTenantGraph(store, body.tenantId);
      const job = createScanJob("production", body.tenantId, body.siteIds.length);
      void ingestConnectedSites(graph, token, body.tenantId, body.siteIds, (progress) => updateScanJob(job, progress))
        .then(async (result) => {
          Object.assign(job, result, {
            status: "completed",
            stage: "completed",
            completedSites: result.requestedSites,
            currentSiteId: null,
            result,
            updatedAt: new Date().toISOString(),
          });
          await store.audit("scan_sites", body.tenantId, result.failedSites ? "partial" : "succeeded", result).catch(() => undefined);
        })
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : "Unexpected tenant scan failure.";
          Object.assign(job, {
            status: "failed",
            stage: "failed",
            currentSiteId: null,
            error: message,
            updatedAt: new Date().toISOString(),
          });
          await store.audit("scan_sites", body.tenantId, "failed", { message }).catch(() => undefined);
        });
      return response.status(202).json(publicScanJob(job));
    } catch (error) {
      next(error);
    }
  });

  router.get("/scan-history", async (request, response, next) => {
    try {
      if (isDemoMode) return response.json({ scans: [] });
      const tenantId = z.string().uuid().optional().parse(request.query.tenantId);
      const scans = await store.recentAudit("scan_sites", tenantId, 25);
      return response.json({ scans });
    } catch (error) {
      next(error);
    }
  });

  router.get("/scan/:jobId", (request, response) => {
    const job = tenantScanJobs.get(request.params.jobId);
    if (!job) return response.status(404).json({ error: "Scan job not found. It may have expired after a server restart." });
    return response.json(publicScanJob(job));
  });

  router.post("/disconnect", async (request, response, next) => {
    if (isDemoMode) {
      demoConnected = false;
      return response.json({ status: "not_connected", health: "Demo tenant disconnected. No external Microsoft service was changed." });
    }
    requireProductionEnvironment(["MICROSOFT_BOOTSTRAP_CLIENT_ID", "MICROSOFT_BOOTSTRAP_CLIENT_SECRET", "MICROSOFT_SECRET_ENCRYPTION_KEY"]);
    const session = currentSession(request);
    if (!session) return response.status(401).json({ error: "Microsoft administrator authorization is required." });
    try {
      const body = z.object({ deleteApplication: z.boolean().default(false) }).parse(request.body);
      const connection = await store.getInternal(session.tenantId);
      if (!connection?.applicationObjectId || !connection.servicePrincipalObjectId) throw new Error("No provisioned connector application was found.");
      const allowDelete = process.env.MICROSOFT_ALLOW_DESTRUCTIVE_DISCONNECT === "true";
      const provisioner = new MicrosoftTenantProvisioning(new HttpGraphClient(session.accessToken));
      const result = await provisioner.disconnect(connection.applicationObjectId, connection.servicePrincipalObjectId, allowDelete && body.deleteApplication);
      await store.upsert({ ...connection, encryptedClientSecret: null, status: "disconnected", health: `Connector ${result}. Stored credential removed.`, failureReason: null, updatedAt: new Date().toISOString() });
      await store.audit("disconnect", session.tenantId, result);
      response.json(await store.get(session.tenantId));
    } catch (error) {
      await store.audit("disconnect", session.tenantId, "failed", { message: error instanceof Error ? error.message : "Unexpected disconnect error" });
      next(error);
    }
  });

  return router;
}

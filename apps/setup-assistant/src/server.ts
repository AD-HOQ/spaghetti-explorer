import "dotenv/config";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "256kb" }));

const isDemoMode = process.env.APP_MODE !== "production";
const setupClientId = process.env.SETUP_ASSISTANT_CLIENT_ID;
const setupClientSecret = process.env.SETUP_ASSISTANT_CLIENT_SECRET;
const setupRedirectUri = process.env.SETUP_ASSISTANT_REDIRECT_URI ?? "http://localhost:4100/api/auth/callback";
const isConfiguredValue = (value: string | undefined) => Boolean(value && !value.startsWith("replace-with-") && value !== "00000000-0000-0000-0000-000000000000");
const microsoftSignInConfigured = !isDemoMode && isConfiguredValue(setupClientId) && isConfiguredValue(setupClientSecret);
const authScopes = [
  "openid",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/Organization.Read.All",
];

const graphAppId = "00000003-0000-0000-c000-000000000000";
const graphRoles = {
  "Sites.Read.All": "332a536c-c7ef-4017-ab91-336970924f0d",
  "Files.Read.All": "01d4889c-1287-42c6-ac1f-5d1e02578ef6",
  "User.Read.All": "df021288-bdef-4463-88db-98f22de89214",
  "GroupMember.Read.All": "98830695-27a2-44f7-8c18-0c3ebc9698f6",
  "Sites.FullControl.All": "a82116e5-55eb-4c41-a434-62fe8a61c773",
} as const;

const profiles = {
  discovery: {
    label: "Discovery only",
    description: "Read SharePoint hierarchy, directory principals, group memberships, and permissions.",
    permissions: ["Sites.Read.All", "Files.Read.All", "User.Read.All", "GroupMember.Read.All"] as Array<keyof typeof graphRoles>,
  },
  remediation: {
    label: "Discovery + remediation",
    description: "Includes discovery permissions and broad SharePoint permission-management capability.",
    permissions: ["Sites.Read.All", "Files.Read.All", "User.Read.All", "GroupMember.Read.All", "Sites.FullControl.All"] as Array<keyof typeof graphRoles>,
  },
};

type GraphApplication = { id: string; appId: string; displayName: string };
type GraphServicePrincipal = { id: string; appId: string };
type AuthSession = {
  accessToken: string;
  expiresAt: number;
  tenantId: string;
  tenantName: string;
  administrator: string;
};
type PendingAuthorization = { verifier: string; sessionId: string; tenantAuthority: string; createdAt: number };

const authSessions = new Map<string, AuthSession>();
const pendingAuthorizations = new Map<string, PendingAuthorization>();

function base64Url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function cookieValue(request: express.Request, name: string) {
  const cookie = request.header("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

function currentSession(request: express.Request) {
  const sessionId = cookieValue(request, "spaghetti_setup_session");
  const session = sessionId ? authSessions.get(sessionId) : undefined;
  if (session && session.expiresAt > Date.now()) return session;
  if (sessionId) authSessions.delete(sessionId);
  return undefined;
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Microsoft did not return a valid identity token.");
  return z.object({
    tid: z.string().uuid(),
    name: z.string().optional(),
    preferred_username: z.string().optional(),
  }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}

async function graphRequest<T>(token: string, path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  if (isDemoMode) throw new Error("Microsoft Graph is disabled while APP_MODE=demo.");
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Microsoft Graph ${method} ${path} failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}

function provisioningPlan(profile: keyof typeof profiles, tenantId: string, displayName: string, redirectUri: string) {
  const selected = profiles[profile];
  return {
    tenantId,
    displayName,
    profile,
    redirectUri,
    permissions: selected.permissions,
    steps: [
      "Validate the administrator's delegated Microsoft Graph token",
      "Create the Spaghetti application registration",
      "Create the enterprise application service principal",
      "Create a one-time application client credential",
      "Generate the tenant admin-consent URL",
      "Transfer the resulting credential directly into the Spaghetti API",
    ],
  };
}

app.get("/api/health", (_request, response) => response.json({ ok: true, service: "spaghetti-setup-assistant", appMode: isDemoMode ? "demo" : "production" }));
app.get("/api/setup/manifest", (_request, response) => response.json({ graphAppId, profiles, microsoftSignInConfigured, appMode: isDemoMode ? "demo" : "production" }));

app.get("/api/auth/status", (request, response) => {
  if (isDemoMode) {
    return response.json({
      configured: true,
      connected: true,
      tenantId: "11111111-1111-4111-8111-111111111111",
      tenantName: "Contoso Demo Tenant",
      administrator: "admin@contoso-demo.com",
      expiresAt: null,
      appMode: "demo",
    });
  }
  const session = currentSession(request);
  response.json({
    configured: microsoftSignInConfigured,
    connected: Boolean(session),
    tenantId: session?.tenantId,
    tenantName: session?.tenantName,
    administrator: session?.administrator,
    expiresAt: session ? new Date(session.expiresAt).toISOString() : undefined,
  });
});

app.get("/api/auth/login", (request, response, next) => {
  try {
    if (isDemoMode) return response.redirect("/?auth=demo");
    if (!microsoftSignInConfigured || !setupClientId || !setupClientSecret) {
      return response.status(503).json({ error: "Configure SETUP_ASSISTANT_CLIENT_ID and SETUP_ASSISTANT_CLIENT_SECRET before connecting Microsoft." });
    }
    const tenant = z.string().uuid().or(z.literal("organizations")).default("organizations").parse(request.query.tenantId);
    const sessionId = cookieValue(request, "spaghetti_setup_session") ?? base64Url(randomBytes(24));
    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    pendingAuthorizations.set(state, { verifier, sessionId, tenantAuthority: tenant, createdAt: Date.now() });

    const authorizeUrl = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: setupClientId,
      response_type: "code",
      redirect_uri: setupRedirectUri,
      response_mode: "query",
      scope: authScopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return response.redirect(authorizeUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/callback", async (request, response, next) => {
  try {
    if (isDemoMode) return response.redirect("/?auth=demo");
    if (!microsoftSignInConfigured || !setupClientId || !setupClientSecret) throw new Error("Microsoft sign-in is not configured.");
    const query = z.object({
      code: z.string().min(10),
      state: z.string().min(10),
    }).parse(request.query);
    const pending = pendingAuthorizations.get(query.state);
    if (!pending || Date.now() - pending.createdAt > 10 * 60_000) throw new Error("The Microsoft sign-in request expired. Start the connection again.");
    pendingAuthorizations.delete(query.state);

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${pending.tenantAuthority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: setupClientId,
        client_secret: setupClientSecret,
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: setupRedirectUri,
        code_verifier: pending.verifier,
        scope: authScopes.join(" "),
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; id_token?: string; expires_in?: number; error_description?: string };
    if (!tokenResponse.ok || !token.access_token || !token.id_token) {
      throw new Error(token.error_description ?? "Microsoft did not return the expected authorization tokens.");
    }
    const identity = decodeJwtPayload(token.id_token);
    const organization = await graphRequest<{ value: Array<{ id: string; displayName: string }> }>(token.access_token, "/organization?$select=id,displayName", "GET");
    const tenant = organization.value[0];
    authSessions.set(pending.sessionId, {
      accessToken: token.access_token,
      expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
      tenantId: identity.tid,
      tenantName: tenant?.displayName ?? identity.tid,
      administrator: identity.name ?? identity.preferred_username ?? "Microsoft administrator",
    });
    response.setHeader("Set-Cookie", `spaghetti_setup_session=${encodeURIComponent(pending.sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(60, token.expires_in ?? 3600)}`);
    return response.redirect("/?auth=connected");
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (request, response) => {
  const sessionId = cookieValue(request, "spaghetti_setup_session");
  if (sessionId) authSessions.delete(sessionId);
  response.setHeader("Set-Cookie", "spaghetti_setup_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  response.json({ ok: true });
});

app.post("/api/setup/preview", (request, response, next) => {
  try {
    const body = z.object({
      tenantId: z.string().uuid(),
      displayName: z.string().min(3).max(120),
      profile: z.enum(["discovery", "remediation"]),
      redirectUri: z.string().url(),
    }).parse(request.body);
    response.json({ ok: true, plan: provisioningPlan(body.profile, body.tenantId, body.displayName, body.redirectUri) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/setup/provision", async (request, response, next) => {
  try {
    const body = z.object({
      tenantId: z.string().uuid(),
      displayName: z.string().min(3).max(120),
      profile: z.enum(["discovery", "remediation"]),
      redirectUri: z.string().url(),
      spaghettiApiUrl: z.string().url(),
      handoffToken: z.string().min(16).optional(),
    }).parse(request.body);
    if (isDemoMode) {
      return response.status(201).json({
        ok: true,
        mode: "demo",
        application: { objectId: "22222222-2222-4222-8222-222222222222", clientId: "00000000-0000-0000-0000-000000000000", displayName: body.displayName },
        servicePrincipal: { objectId: "33333333-3333-4333-8333-333333333333" },
        credential: { keyId: "44444444-4444-4444-8444-444444444444", expiresAt: null, transferredToSpaghetti: false },
        permissions: profiles[body.profile].permissions,
        consentUrl: null,
        nextStep: "Demo provisioning completed without calling Microsoft services.",
      });
    }
    const session = currentSession(request);
    if (!body.handoffToken) throw new Error("SETUP_HANDOFF_TOKEN is required while APP_MODE=production.");
    if (!session) return response.status(401).json({ error: "Connect a Microsoft tenant before provisioning." });
    if (session.tenantId !== body.tenantId) return response.status(409).json({ error: "The configured tenant does not match the connected Microsoft tenant." });
    const selected = profiles[body.profile];

    await graphRequest(session.accessToken, "/organization?$select=id,displayName", "GET");
    const application = await graphRequest<GraphApplication>(session.accessToken, "/applications", "POST", {
      displayName: body.displayName,
      signInAudience: "AzureADMyOrg",
      web: { redirectUris: [body.redirectUri] },
      requiredResourceAccess: [{
        resourceAppId: graphAppId,
        resourceAccess: selected.permissions.map((permission) => ({ id: graphRoles[permission], type: "Role" })),
      }],
      tags: ["Spaghetti Explorer", `Spaghetti Profile:${body.profile}`],
    });
    const servicePrincipal = await graphRequest<GraphServicePrincipal>(session.accessToken, "/servicePrincipals", "POST", {
      appId: application.appId,
      tags: ["Spaghetti Explorer"],
    });
    const credential = await graphRequest<{ secretText: string; keyId: string; endDateTime: string }>(
      session.accessToken,
      `/applications/${application.id}/addPassword`,
      "POST",
      { passwordCredential: { displayName: "Spaghetti Setup Assistant", endDateTime: new Date(Date.now() + 180 * 86400000).toISOString() } },
    );

    const handoffResponse = await fetch(`${body.spaghettiApiUrl.replace(/\/$/, "")}/api/setup/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Spaghetti-Setup-Token": body.handoffToken },
      body: JSON.stringify({
        tenantId: body.tenantId,
        clientId: application.appId,
        clientSecret: credential.secretText,
        applicationObjectId: application.id,
        servicePrincipalId: servicePrincipal.id,
        credentialKeyId: credential.keyId,
        credentialExpiresAt: credential.endDateTime,
        profile: body.profile,
        permissions: selected.permissions,
        configuredAt: new Date().toISOString(),
      }),
    });
    if (!handoffResponse.ok) throw new Error(`Spaghetti handoff failed (${handoffResponse.status}): ${await handoffResponse.text()}`);

    const consentUrl = `https://login.microsoftonline.com/${body.tenantId}/adminconsent?client_id=${application.appId}&redirect_uri=${encodeURIComponent(body.redirectUri)}&state=${encodeURIComponent(application.id)}`;
    response.status(201).json({
      ok: true,
      application: { objectId: application.id, clientId: application.appId, displayName: application.displayName },
      servicePrincipal: { objectId: servicePrincipal.id },
      credential: { keyId: credential.keyId, expiresAt: credential.endDateTime, transferredToSpaghetti: true },
      permissions: selected.permissions,
      consentUrl,
      nextStep: "Open the admin-consent URL and approve the configured application permissions.",
    });
  } catch (error) {
    next(error);
  }
});

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
if (existsSync(publicDirectory)) {
  app.use(express.static(publicDirectory));
  app.get("/{*path}", (_request, response) => response.sendFile(`${publicDirectory}/index.html`));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(400).json({ error: error instanceof Error ? error.message : "Unexpected setup error" });
});

const port = Number(process.env.SETUP_ASSISTANT_PORT ?? 4100);
app.listen(port, () => console.log(`Spaghetti Setup Assistant listening on http://localhost:${port}`));

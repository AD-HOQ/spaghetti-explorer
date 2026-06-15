import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { databaseAvailable, pool } from "./db.js";

export type MicrosoftConnectionStatus =
  | "not_connected"
  | "microsoft_authorization_required"
  | "provisioning_app_registration"
  | "creating_service_principal"
  | "granting_graph_permissions"
  | "verifying_graph_access"
  | "connected"
  | "failed"
  | "credential_expiring_soon"
  | "disconnected";

export type MicrosoftTenantConnection = {
  tenantId: string;
  tenantDisplayName: string | null;
  applicationObjectId: string | null;
  clientId: string | null;
  servicePrincipalObjectId: string | null;
  credentialKeyId: string | null;
  credentialExpiresAt: string | null;
  encryptedClientSecret?: string | null;
  grantedPermissions: string[];
  status: MicrosoftConnectionStatus;
  health: string;
  failureReason: string | null;
  createdByUserId: string | null;
  createdByUpn: string | null;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
};

export type PendingOnboarding = {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: string;
};

const memoryConnections = new Map<string, MicrosoftTenantConnection>();
const memoryPending = new Map<string, PendingOnboarding>();
const memoryAudit: Array<Record<string, unknown>> = [];

function encryptionKey() {
  const configured = process.env.MICROSOFT_SECRET_ENCRYPTION_KEY;
  if (!configured) throw new Error("MICROSOFT_SECRET_ENCRYPTION_KEY must be configured before connector credentials can be stored.");
  return createHash("sha256").update(configured).digest();
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored connector credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function publicConnection(connection: MicrosoftTenantConnection) {
  const { encryptedClientSecret: _secret, ...safe } = connection;
  return { ...safe, grantedPermissions: Array.isArray(safe.grantedPermissions) ? safe.grantedPermissions : [] };
}

export class MicrosoftOnboardingStore {
  async savePending(pending: PendingOnboarding) {
    memoryPending.set(pending.state, pending);
    if (!(await databaseAvailable())) return;
    await pool.query(
      `INSERT INTO microsoft_onboarding_states (state, nonce, code_verifier_encrypted, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $4::timestamptz + interval '10 minutes')
       ON CONFLICT (state) DO UPDATE SET nonce = EXCLUDED.nonce, code_verifier_encrypted = EXCLUDED.code_verifier_encrypted,
         created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
      [pending.state, pending.nonce, encryptSecret(pending.codeVerifier), pending.createdAt],
    );
  }

  async consumePending(state: string) {
    const memory = memoryPending.get(state);
    memoryPending.delete(state);
    if (memory) return memory;
    if (!(await databaseAvailable())) return null;
    const result = await pool.query(
      `DELETE FROM microsoft_onboarding_states WHERE state = $1 AND expires_at > now()
       RETURNING state, nonce, code_verifier_encrypted AS "codeVerifierEncrypted", created_at AS "createdAt"`,
      [state],
    );
    const pending = result.rows[0] as { state: string; nonce: string; codeVerifierEncrypted: string; createdAt: Date } | undefined;
    return pending ? { state: pending.state, nonce: pending.nonce, codeVerifier: decryptSecret(pending.codeVerifierEncrypted), createdAt: pending.createdAt.toISOString() } : null;
  }

  async upsert(connection: MicrosoftTenantConnection) {
    memoryConnections.set(connection.tenantId, connection);
    if (!(await databaseAvailable())) return;
    await pool.query(
      `INSERT INTO microsoft_tenant_connections (
        tenant_id, tenant_display_name, application_object_id, client_id, service_principal_object_id,
        credential_key_id, credential_expires_at, encrypted_client_secret, granted_permissions, status,
        health, failure_reason, created_by_user_id, created_by_upn, created_at, updated_at, last_verified_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (tenant_id) DO UPDATE SET
        tenant_display_name=EXCLUDED.tenant_display_name, application_object_id=EXCLUDED.application_object_id,
        client_id=EXCLUDED.client_id, service_principal_object_id=EXCLUDED.service_principal_object_id,
        credential_key_id=EXCLUDED.credential_key_id, credential_expires_at=EXCLUDED.credential_expires_at,
        encrypted_client_secret=COALESCE(EXCLUDED.encrypted_client_secret, microsoft_tenant_connections.encrypted_client_secret),
        granted_permissions=EXCLUDED.granted_permissions, status=EXCLUDED.status, health=EXCLUDED.health,
        failure_reason=EXCLUDED.failure_reason, created_by_user_id=EXCLUDED.created_by_user_id,
        created_by_upn=EXCLUDED.created_by_upn, updated_at=EXCLUDED.updated_at, last_verified_at=EXCLUDED.last_verified_at`,
      [
        connection.tenantId, connection.tenantDisplayName, connection.applicationObjectId, connection.clientId,
        connection.servicePrincipalObjectId, connection.credentialKeyId, connection.credentialExpiresAt,
        connection.encryptedClientSecret, JSON.stringify(connection.grantedPermissions), connection.status, connection.health,
        connection.failureReason, connection.createdByUserId, connection.createdByUpn, connection.createdAt,
        connection.updatedAt, connection.lastVerifiedAt,
      ],
    );
  }

  async get(tenantId?: string) {
    if (tenantId && memoryConnections.has(tenantId)) return publicConnection(memoryConnections.get(tenantId) as MicrosoftTenantConnection);
    if (!tenantId && memoryConnections.size) return publicConnection([...memoryConnections.values()][0]);
    if (!(await databaseAvailable())) return null;
    const result = await pool.query(
      `SELECT tenant_id AS "tenantId", tenant_display_name AS "tenantDisplayName",
        application_object_id AS "applicationObjectId", client_id AS "clientId",
        service_principal_object_id AS "servicePrincipalObjectId", credential_key_id AS "credentialKeyId",
        credential_expires_at AS "credentialExpiresAt", granted_permissions AS "grantedPermissions",
        status, health, failure_reason AS "failureReason", created_by_user_id AS "createdByUserId",
        created_by_upn AS "createdByUpn", created_at AS "createdAt", updated_at AS "updatedAt",
        last_verified_at AS "lastVerifiedAt"
       FROM microsoft_tenant_connections
       ${tenantId ? "WHERE tenant_id = $1" : ""}
       ORDER BY updated_at DESC LIMIT 1`,
      tenantId ? [tenantId] : [],
    );
    const connection = result.rows[0] as MicrosoftTenantConnection | undefined;
    return connection ? publicConnection(connection) : null;
  }

  async getInternal(tenantId: string) {
    const memory = memoryConnections.get(tenantId);
    if (memory) return memory;
    if (!(await databaseAvailable())) return null;
    const result = await pool.query(
      `SELECT tenant_id AS "tenantId", tenant_display_name AS "tenantDisplayName",
        application_object_id AS "applicationObjectId", client_id AS "clientId",
        service_principal_object_id AS "servicePrincipalObjectId", credential_key_id AS "credentialKeyId",
        credential_expires_at AS "credentialExpiresAt", encrypted_client_secret AS "encryptedClientSecret",
        granted_permissions AS "grantedPermissions", status, health, failure_reason AS "failureReason",
        created_by_user_id AS "createdByUserId", created_by_upn AS "createdByUpn", created_at AS "createdAt",
        updated_at AS "updatedAt", last_verified_at AS "lastVerifiedAt"
       FROM microsoft_tenant_connections WHERE tenant_id = $1`,
      [tenantId],
    );
    const connection = result.rows[0] as MicrosoftTenantConnection | undefined;
    return connection
      ? { ...connection, grantedPermissions: Array.isArray(connection.grantedPermissions) ? connection.grantedPermissions : [] }
      : null;
  }

  async updateStatus(tenantId: string, status: MicrosoftConnectionStatus, health: string, failureReason: string | null = null) {
    const now = new Date().toISOString();
    const current = memoryConnections.get(tenantId);
    if (current) memoryConnections.set(tenantId, { ...current, status, health, failureReason, updatedAt: now });
    if (await databaseAvailable()) {
      await pool.query(
        `UPDATE microsoft_tenant_connections SET status=$2, health=$3, failure_reason=$4, updated_at=$5 WHERE tenant_id=$1`,
        [tenantId, status, health, failureReason, now],
      );
    }
  }

  async audit(eventType: string, tenantId: string | null, outcome: string, details: Record<string, unknown> = {}) {
    const entry = { eventType, tenantId, outcome, details, createdAt: new Date().toISOString() };
    memoryAudit.push(entry);
    if (await databaseAvailable()) {
      await pool.query(
        `INSERT INTO microsoft_onboarding_audit_log (tenant_id, event_type, outcome, details) VALUES ($1,$2,$3,$4)`,
        [tenantId, eventType, outcome, details],
      );
    }
  }

  async recentAudit(eventType: string, tenantId?: string, limit = 25) {
    if (!(await databaseAvailable())) {
      return memoryAudit
        .filter((entry) => entry.eventType === eventType && (!tenantId || entry.tenantId === tenantId))
        .slice(-limit)
        .reverse();
    }
    const result = await pool.query(
      `SELECT id, tenant_id AS "tenantId", event_type AS "eventType", outcome, details, created_at AS "createdAt"
       FROM microsoft_onboarding_audit_log
       WHERE event_type = $1 AND ($2::uuid IS NULL OR tenant_id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [eventType, tenantId ?? null, limit],
    );
    return result.rows;
  }
}

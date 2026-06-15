import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { databaseAvailable, pool } from "./db.js";

export type PermissionActionEventType = "loaded" | "running" | "succeeded" | "failed";

export type PermissionActionRecord = {
  id: string;
  kind: string;
  label: string;
  nodeId: string;
  nodeName: string;
  principalId?: string;
  principalName?: string;
  grantIndex?: number;
  command: Record<string, unknown>;
};

export type PermissionActionLogEvent = PermissionActionRecord & {
  eventId: string;
  actionId: string;
  eventType: PermissionActionEventType;
  message: string | null;
  createdAt: string;
};

const fallbackPath = resolve(process.env.ACTION_LOG_FILE ?? ".data/permission-action-logs.json");
let fallbackWrite = Promise.resolve();
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS permission_action_logs (
      id uuid PRIMARY KEY,
      action_id uuid NOT NULL,
      event_type varchar NOT NULL CHECK (event_type IN ('loaded', 'running', 'succeeded', 'failed')),
      action_kind varchar NOT NULL,
      action_label varchar NOT NULL,
      node_id varchar NOT NULL,
      node_name varchar NOT NULL,
      principal_id varchar,
      principal_name varchar,
      grant_index int,
      command jsonb NOT NULL,
      message text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS permission_action_logs_action_idx ON permission_action_logs (action_id, created_at);
    CREATE INDEX IF NOT EXISTS permission_action_logs_created_idx ON permission_action_logs (created_at DESC);
  `).then(() => undefined);
  return schemaReady;
}

async function readFallback() {
  try {
    return JSON.parse(await readFile(fallbackPath, "utf8")) as PermissionActionLogEvent[];
  } catch {
    return [];
  }
}

async function appendFallback(event: PermissionActionLogEvent) {
  fallbackWrite = fallbackWrite.then(async () => {
    const events = await readFallback();
    events.unshift(event);
    await mkdir(dirname(fallbackPath), { recursive: true });
    await writeFile(fallbackPath, JSON.stringify(events, null, 2), "utf8");
  });
  await fallbackWrite;
}

export class PermissionActionLogStore {
  async append(action: PermissionActionRecord, eventType: PermissionActionEventType, message?: string | null) {
    const event: PermissionActionLogEvent = {
      ...action,
      eventId: randomUUID(),
      actionId: action.id,
      eventType,
      message: message ?? null,
      createdAt: new Date().toISOString(),
    };
    if (await databaseAvailable()) {
      await ensureSchema();
      await pool.query(
        `INSERT INTO permission_action_logs (
          id, action_id, event_type, action_kind, action_label, node_id, node_name,
          principal_id, principal_name, grant_index, command, message, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          event.eventId, event.actionId, event.eventType, event.kind, event.label, event.nodeId, event.nodeName,
          event.principalId ?? null, event.principalName ?? null, event.grantIndex ?? null, event.command,
          event.message, event.createdAt,
        ],
      );
    } else {
      await appendFallback(event);
    }
    return event;
  }

  async list(limit = 1000) {
    if (!(await databaseAvailable())) return (await readFallback()).slice(0, limit);
    await ensureSchema();
    const result = await pool.query(
      `SELECT id AS "eventId", action_id AS "actionId", event_type AS "eventType",
        action_kind AS kind, action_label AS label, node_id AS "nodeId", node_name AS "nodeName",
        principal_id AS "principalId", principal_name AS "principalName", grant_index AS "grantIndex",
        command, message, created_at AS "createdAt"
       FROM permission_action_logs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows as PermissionActionLogEvent[];
  }

  async markInterruptedActions() {
    const events = await this.list(5000);
    const latestByAction = new Map<string, PermissionActionLogEvent>();
    events.forEach((event) => {
      if (!latestByAction.has(event.actionId)) latestByAction.set(event.actionId, event);
    });
    const interrupted = [...latestByAction.values()].filter((event) => event.eventType === "running");
    await Promise.all(interrupted.map((event) => this.append(
      { ...event, id: event.actionId },
      "failed",
      "Action execution was interrupted by a server restart.",
    )));
    return interrupted.length;
  }
}

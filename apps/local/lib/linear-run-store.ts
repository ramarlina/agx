import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { pragmaSet } from "./sqlite-compat";

const HISTORY_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(HISTORY_DIR, "history.sqlite");

type ChatRunStatus =
  | "queued"
  | "running"
  | "awaiting_user"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type LinearRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

interface LinearRunRow {
  id: string;
  project_id: string | null;
  project_slug: string | null;
  issue_id: string;
  issue_identifier: string;
  issue_title: string;
  issue_status: string;
  issue_assignee: string | null;
  thread_id: string;
  root_message_id: string | null;
  chat_run_id: string | null;
  agent_id: string;
  agent_name: string;
  status: LinearRunStatus;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface JoinedLinearRunRow extends LinearRunRow {
  chat_status: ChatRunStatus | null;
  chat_last_error: string | null;
  chat_created_at: number | null;
  chat_updated_at: number | null;
  chat_completed_at: number | null;
}

export interface LinearRunRecord {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee: string | null;
  threadId: string;
  rootMessageId: string | null;
  chatRunId: string | null;
  agentId: string;
  agentName: string;
  status: LinearRunStatus;
  durationMs: number | null;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function toOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toIso(timestampMs: number | null): string | null {
  return typeof timestampMs === "number" ? new Date(timestampMs).toISOString() : null;
}

function mapChatStatus(
  chatStatus: ChatRunStatus | null,
  fallbackStatus: LinearRunStatus
): LinearRunStatus {
  switch (chatStatus) {
    case "queued":
      return "queued";
    case "running":
    case "awaiting_user":
    case "blocked":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return fallbackStatus;
  }
}

function mapRow(row: JoinedLinearRunRow): LinearRunRecord {
  const startedAtMs = row.chat_created_at ?? row.created_at;
  const completedAtMs = row.chat_completed_at ?? null;
  const status = mapChatStatus(row.chat_status, row.status);
  return {
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    issueId: row.issue_id,
    issueIdentifier: row.issue_identifier,
    issueTitle: row.issue_title,
    issueStatus: row.issue_status,
    issueAssignee: row.issue_assignee,
    threadId: row.thread_id,
    rootMessageId: row.root_message_id,
    chatRunId: row.chat_run_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    status,
    durationMs:
      completedAtMs != null ? Math.max(completedAtMs - startedAtMs, 0) : null,
    lastError: row.chat_last_error ?? row.error,
    startedAt: new Date(startedAtMs).toISOString(),
    updatedAt: new Date((row.chat_updated_at ?? row.updated_at) || row.updated_at).toISOString(),
    completedAt: toIso(completedAtMs),
  };
}

async function withLinearRunDatabase<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        root_message_id TEXT,
        user_id TEXT NOT NULL,
        project_slug TEXT,
        status TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        max_steps INTEGER NOT NULL DEFAULT 10,
        steps_used INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        active_participant_ids TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS linear_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        project_slug TEXT,
        issue_id TEXT NOT NULL,
        issue_identifier TEXT NOT NULL,
        issue_title TEXT NOT NULL,
        issue_status TEXT NOT NULL,
        issue_assignee TEXT,
        thread_id TEXT NOT NULL,
        root_message_id TEXT,
        chat_run_id TEXT,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_linear_runs_issue_created
        ON linear_runs (issue_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_linear_runs_project_issue_created
        ON linear_runs (project_id, issue_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_linear_runs_chat_run_id
        ON linear_runs (chat_run_id)
        WHERE chat_run_id IS NOT NULL;
    `);
    return run(db);
  } finally {
    db.close();
  }
}

export async function createLinearRun(input: {
  id?: string;
  projectId?: string | null;
  projectSlug?: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee?: string | null;
  threadId?: string;
  agentId: string;
  agentName: string;
}): Promise<LinearRunRecord> {
  const now = Date.now();
  const id = toOptionalString(input.id) ?? crypto.randomUUID();
  const threadId = toOptionalString(input.threadId) ?? `linear-run:${id}`;

  return withLinearRunDatabase((db) => {
    db.prepare(
      `INSERT INTO linear_runs (
        id, project_id, project_slug, issue_id, issue_identifier, issue_title,
        issue_status, issue_assignee, thread_id, root_message_id, chat_run_id,
        agent_id, agent_name, status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'queued', NULL, ?, ?)`
    ).run(
      id,
      toOptionalString(input.projectId ?? null),
      toOptionalString(input.projectSlug ?? null),
      input.issueId.trim(),
      input.issueIdentifier.trim(),
      input.issueTitle.trim(),
      input.issueStatus.trim(),
      toOptionalString(input.issueAssignee ?? null),
      threadId,
      input.agentId.trim(),
      input.agentName.trim(),
      now,
      now
    );

    const row = db
      .prepare(
        `SELECT
          lr.*,
          cr.status AS chat_status,
          cr.last_error AS chat_last_error,
          cr.created_at AS chat_created_at,
          cr.updated_at AS chat_updated_at,
          cr.completed_at AS chat_completed_at
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = lr.chat_run_id
         WHERE lr.id = ?
         LIMIT 1`
      )
      .get(id) as JoinedLinearRunRow | undefined;

    if (!row) {
      throw new Error(`Failed to create Linear run ${id}`);
    }

    return mapRow(row);
  });
}

export async function updateLinearRun(input: {
  id: string;
  rootMessageId?: string | null;
  chatRunId?: string | null;
  status?: LinearRunStatus;
  error?: string | null;
}): Promise<LinearRunRecord | null> {
  return withLinearRunDatabase((db) => {
    const updates: string[] = ["updated_at = ?"];
    const params: Array<number | string | null> = [Date.now()];

    if (input.rootMessageId !== undefined) {
      updates.push("root_message_id = ?");
      params.push(toOptionalString(input.rootMessageId));
    }
    if (input.chatRunId !== undefined) {
      updates.push("chat_run_id = ?");
      params.push(toOptionalString(input.chatRunId));
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      params.push(input.status);
    }
    if (input.error !== undefined) {
      updates.push("error = ?");
      params.push(toOptionalString(input.error));
    }

    params.push(input.id.trim());

    db.prepare(`UPDATE linear_runs SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params
    );

    const row = db
      .prepare(
        `SELECT
          lr.*,
          cr.status AS chat_status,
          cr.last_error AS chat_last_error,
          cr.created_at AS chat_created_at,
          cr.updated_at AS chat_updated_at,
          cr.completed_at AS chat_completed_at
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = lr.chat_run_id
         WHERE lr.id = ?
         LIMIT 1`
      )
      .get(input.id.trim()) as JoinedLinearRunRow | undefined;

    return row ? mapRow(row) : null;
  });
}

export async function getLinearRun(id: string): Promise<LinearRunRecord | null> {
  return withLinearRunDatabase((db) => {
    const row = db
      .prepare(
        `SELECT
          lr.*,
          cr.status AS chat_status,
          cr.last_error AS chat_last_error,
          cr.created_at AS chat_created_at,
          cr.updated_at AS chat_updated_at,
          cr.completed_at AS chat_completed_at
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = lr.chat_run_id
         WHERE lr.id = ?
         LIMIT 1`
      )
      .get(id.trim()) as JoinedLinearRunRow | undefined;
    return row ? mapRow(row) : null;
  });
}

export async function listLinearRuns(input: {
  issueId: string;
  projectId?: string | null;
  limit?: number;
}): Promise<LinearRunRecord[]> {
  const issueId = input.issueId.trim();
  const projectId = toOptionalString(input.projectId ?? null);
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(Number(input.limit), 1), 100)
    : 50;

  return withLinearRunDatabase((db) => {
    const params: Array<string | number> = [issueId];
    const clauses = ["lr.issue_id = ?"];

    if (projectId) {
      clauses.push("lr.project_id = ?");
      params.push(projectId);
    }

    params.push(limit);

    const rows = db
      .prepare(
        `SELECT
          lr.*,
          cr.status AS chat_status,
          cr.last_error AS chat_last_error,
          cr.created_at AS chat_created_at,
          cr.updated_at AS chat_updated_at,
          cr.completed_at AS chat_completed_at
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = lr.chat_run_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY lr.created_at DESC
         LIMIT ?`
      )
      .all(...params) as unknown as JoinedLinearRunRow[];

    return rows.map(mapRow);
  });
}

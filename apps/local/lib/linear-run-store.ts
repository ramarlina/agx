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

export type LinearRunMode = "chat" | "scripted";

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
  mode: LinearRunMode;
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
  root_content: string | null;
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
  mode: LinearRunMode;
  sessionTitle: string | null;
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

function normalizeMode(value: string | null | undefined): LinearRunMode {
  return value === "scripted" ? "scripted" : "chat";
}

function toSessionTitle(content: string | null | undefined): string | null {
  const normalized = String(content ?? "")
    .replace(/\[reaction\s+[^\]]*\]/gi, "")
    .replace(/\[agx:[^\]]*\]/g, "")
    .replace(/\[checkpoint\]/g, "")
    .replace(/\[criteria:\s*[^\]]*\]/g, "")
    .replace(/\[done\]/g, "")
    .replace(/\[blocked[^\]]*\]/g, "")
    .replace(/^\[SKIP\]$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
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
    mode: normalizeMode(row.mode),
    sessionTitle:
      normalizeMode(row.mode) === "chat" ? toSessionTitle(row.root_content) : null,
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
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        participant_id TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        root_message_id TEXT,
        parent_message_id TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        thread_status TEXT,
        outcome_note TEXT,
        PRIMARY KEY (thread_id, id)
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
        mode TEXT NOT NULL DEFAULT 'chat',
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

    const linearRunColumns = db
      .prepare("PRAGMA table_info(linear_runs)")
      .all() as Array<{ name: string }>;
    if (!linearRunColumns.some((column) => column.name === "mode")) {
      db.exec("ALTER TABLE linear_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat';");
    }

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
  mode?: LinearRunMode;
}): Promise<LinearRunRecord> {
  const now = Date.now();
  const id = toOptionalString(input.id) ?? crypto.randomUUID();
  const threadId = toOptionalString(input.threadId) ?? `linear-run:${id}`;
  const mode = normalizeMode(input.mode);

  return withLinearRunDatabase((db) => {
    db.prepare(
      `INSERT INTO linear_runs (
        id, project_id, project_slug, issue_id, issue_identifier, issue_title,
        issue_status, issue_assignee, thread_id, root_message_id, chat_run_id,
        agent_id, agent_name, mode, status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'queued', NULL, ?, ?)`
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
      mode,
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
          cr.completed_at AS chat_completed_at,
          msg.content AS root_content
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         LEFT JOIN messages msg ON msg.thread_id = lr.thread_id AND msg.id = lr.root_message_id
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
          cr.completed_at AS chat_completed_at,
          msg.content AS root_content
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         LEFT JOIN messages msg ON msg.thread_id = lr.thread_id AND msg.id = lr.root_message_id
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
          cr.completed_at AS chat_completed_at,
          msg.content AS root_content
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         LEFT JOIN messages msg ON msg.thread_id = lr.thread_id AND msg.id = lr.root_message_id
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
          cr.completed_at AS chat_completed_at,
          msg.content AS root_content
         FROM linear_runs lr
         LEFT JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         LEFT JOIN messages msg ON msg.thread_id = lr.thread_id AND msg.id = lr.root_message_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY lr.created_at DESC
         LIMIT ?`
      )
      .all(...params) as unknown as JoinedLinearRunRow[];

    return rows.map(mapRow);
  });
}

export async function getIssueActivityMap(
  projectId?: string | null
): Promise<Map<string, string>> {
  return withLinearRunDatabase((db) => {
    const hasProject = projectId?.trim();
    const sql = hasProject
      ? `SELECT issue_id, MAX(created_at) AS last_activity_at
         FROM linear_runs
         WHERE project_id = ?
         GROUP BY issue_id`
      : `SELECT issue_id, MAX(created_at) AS last_activity_at
         FROM linear_runs
         GROUP BY issue_id`;

    const rows = hasProject
      ? (db.prepare(sql).all(projectId!.trim()) as unknown as Array<{ issue_id: string; last_activity_at: number }>)
      : (db.prepare(sql).all() as unknown as Array<{ issue_id: string; last_activity_at: number }>);

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.issue_id, new Date(row.last_activity_at).toISOString());
    }
    return map;
  });
}

export interface IssueActiveAgent {
  issueId: string;
  agentId: string;
  agentName: string;
}

export async function getIssueActiveAgents(
  projectId?: string | null
): Promise<IssueActiveAgent[]> {
  return withLinearRunDatabase((db) => {
    const hasProject = projectId?.trim();
    const sql = hasProject
      ? `SELECT DISTINCT lr.issue_id, lr.agent_id, lr.agent_name
         FROM linear_runs lr
         INNER JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         WHERE cr.status IN ('queued', 'running')
           AND lr.project_id = ?`
      : `SELECT DISTINCT lr.issue_id, lr.agent_id, lr.agent_name
         FROM linear_runs lr
         INNER JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = lr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         WHERE cr.status IN ('queued', 'running')`;

    const rows = hasProject
      ? (db.prepare(sql).all(projectId!.trim()) as unknown as Array<{ issue_id: string; agent_id: string; agent_name: string }>)
      : (db.prepare(sql).all() as unknown as Array<{ issue_id: string; agent_id: string; agent_name: string }>);

    return rows.map((row) => ({
      issueId: row.issue_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
    }));
  });
}

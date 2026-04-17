// Tracker-agnostic SQLite store for agent execution runs per ticket.
// Migrates the old `linear_runs` table to `tracker_runs` on first use.
// Shares the same database as `chat_runs` and `messages`.

import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { TrackerRunMode, TrackerRunStatus } from "./types";
import { pragmaSet } from "../sqlite-compat";

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

// --- Row types for tracker_runs ---

interface TrackerRunRow {
  id: string;
  project_id: string | null;
  project_slug: string | null;
  tracker_type: string;
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
  mode: TrackerRunMode;
  status: TrackerRunStatus;
  error: string | null;
  recap_file_path: string | null;
  created_at: number;
  updated_at: number;
}

interface JoinedTrackerRunRow extends TrackerRunRow {
  chat_status: ChatRunStatus | null;
  chat_last_error: string | null;
  chat_created_at: number | null;
  chat_updated_at: number | null;
  chat_completed_at: number | null;
  root_content: string | null;
}

export interface TrackerRunRecord {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  trackerType: string;
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
  mode: TrackerRunMode;
  sessionTitle: string | null;
  status: TrackerRunStatus;
  durationMs: number | null;
  lastError: string | null;
  recapFilePath: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// --- Helpers ---

function toOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toIso(timestampMs: number | null): string | null {
  return typeof timestampMs === "number" ? new Date(timestampMs).toISOString() : null;
}

function normalizeMode(value: string | null | undefined): TrackerRunMode {
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
  if (!normalized) return null;
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
}

function mapChatStatus(
  chatStatus: ChatRunStatus | null,
  fallbackStatus: TrackerRunStatus
): TrackerRunStatus {
  switch (chatStatus) {
    case "queued": return "queued";
    case "running":
    case "awaiting_user":
    case "blocked":
      return "running";
    case "completed": return "success";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return fallbackStatus;
  }
}

function mapRow(row: JoinedTrackerRunRow): TrackerRunRecord {
  const startedAtMs = row.chat_created_at ?? row.created_at;
  const completedAtMs = row.chat_completed_at ?? null;
  const status = mapChatStatus(row.chat_status, row.status);
  return {
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    trackerType: row.tracker_type,
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
    sessionTitle: normalizeMode(row.mode) === "chat" ? toSessionTitle(row.root_content) : null,
    status,
    durationMs: completedAtMs != null ? Math.max(completedAtMs - startedAtMs, 0) : null,
    lastError: row.chat_last_error ?? row.error,
    recapFilePath: row.recap_file_path ?? null,
    startedAt: new Date(startedAtMs).toISOString(),
    updatedAt: new Date((row.chat_updated_at ?? row.updated_at) || row.updated_at).toISOString(),
    completedAt: toIso(completedAtMs),
  };
}

// --- Migration ---

function migrateFromLinearRuns(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='linear_runs'")
    .get() as { name: string } | undefined;

  if (!tables) return;

  // Read old data
  const oldRows = db.prepare("SELECT * FROM linear_runs").all() as unknown as Record<string, unknown>[];

  if (oldRows.length > 0) {
    const insert = db.prepare(`
      INSERT INTO tracker_runs (
        id, project_id, project_slug, tracker_type,
        issue_id, issue_identifier, issue_title, issue_status, issue_assignee,
        thread_id, root_message_id, chat_run_id,
        agent_id, agent_name, mode, status, error, recap_file_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tracker_type = excluded.tracker_type
    `);

    for (const row of oldRows) {
      const r = row as Record<string, unknown>;
      insert.run(
        String(r.id),
        toOptionalString(String(r.project_id ?? "")),
        toOptionalString(String(r.project_slug ?? "")),
        "linear",
        String(r.issue_id),
        String(r.issue_identifier),
        String(r.issue_title),
        String(r.issue_status),
        toOptionalString(String(r.issue_assignee ?? "")),
        String(r.thread_id),
        toOptionalString(String(r.root_message_id ?? "")),
        toOptionalString(String(r.chat_run_id ?? "")),
        String(r.agent_id),
        String(r.agent_name),
        normalizeMode(String(r.mode ?? "chat")),
        String(r.status ?? "queued"),
        toOptionalString(String(r.error ?? "")),
        toOptionalString(String(r.recap_file_path ?? "")),
        Number(r.created_at),
        Number(r.updated_at)
      );
    }
  }

  // Drop old table
  db.exec("DROP TABLE IF EXISTS linear_runs");
}

// --- Database access ---

async function withTrackerRunDatabase<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const db = new DatabaseSyncCtor(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    // Ensure chat_runs and messages tables exist (they always share this DB)
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
      CREATE TABLE IF NOT EXISTS tracker_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        project_slug TEXT,
        tracker_type TEXT NOT NULL DEFAULT 'linear',
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
        recap_file_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tracker_runs_issue_created
        ON tracker_runs (issue_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracker_runs_project_issue_created
        ON tracker_runs (project_id, issue_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracker_runs_type_created
        ON tracker_runs (tracker_type, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_runs_chat_run_id
        ON tracker_runs (chat_run_id)
        WHERE chat_run_id IS NOT NULL;
    `);

    // Migrate from old linear_runs table if it exists
    migrateFromLinearRuns(db);

    // Ensure columns that may have been added later
    const trackerRunColumns = db
      .prepare("PRAGMA table_info(tracker_runs)")
      .all() as Array<{ name: string }>;
    if (!trackerRunColumns.some((column) => column.name === "mode")) {
      db.exec("ALTER TABLE tracker_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat';");
    }
    if (!trackerRunColumns.some((column) => column.name === "recap_file_path")) {
      db.exec("ALTER TABLE tracker_runs ADD COLUMN recap_file_path TEXT;");
    }
    if (!trackerRunColumns.some((column) => column.name === "tracker_type")) {
      db.exec("ALTER TABLE tracker_runs ADD COLUMN tracker_type TEXT NOT NULL DEFAULT 'linear';");
    }

    return run(db);
  } finally {
    db.close();
  }
}

// --- Public API ---

const JOINED_SELECT = `
  SELECT
    tr.*,
    cr.status AS chat_status,
    cr.last_error AS chat_last_error,
    cr.created_at AS chat_created_at,
    cr.updated_at AS chat_updated_at,
    cr.completed_at AS chat_completed_at,
    msg.content AS root_content
  FROM tracker_runs tr
  LEFT JOIN chat_runs cr ON cr.id = (
    SELECT id FROM chat_runs WHERE thread_id = tr.thread_id ORDER BY updated_at DESC LIMIT 1
  )
  LEFT JOIN messages msg ON msg.thread_id = tr.thread_id AND msg.id = tr.root_message_id`;

export async function createTrackerRun(input: {
  id?: string;
  projectId?: string | null;
  projectSlug?: string | null;
  trackerType?: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee?: string | null;
  threadId?: string;
  agentId: string;
  agentName: string;
  mode?: TrackerRunMode;
  recapFilePath?: string | null;
}): Promise<TrackerRunRecord> {
  const now = Date.now();
  const id = toOptionalString(input.id) ?? crypto.randomUUID();
  const threadId = toOptionalString(input.threadId) ?? `tracker-run:${id}`;
  const mode = normalizeMode(input.mode);
  const trackerType = input.trackerType ?? "linear";

  return withTrackerRunDatabase((db) => {
    db.prepare(
      `INSERT INTO tracker_runs (
        id, project_id, project_slug, tracker_type,
        issue_id, issue_identifier, issue_title,
        issue_status, issue_assignee, thread_id, root_message_id, chat_run_id,
        agent_id, agent_name, mode, status, error, recap_file_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'queued', NULL, ?, ?, ?)`
    ).run(
      id,
      toOptionalString(input.projectId ?? null),
      toOptionalString(input.projectSlug ?? null),
      trackerType,
      input.issueId.trim(),
      input.issueIdentifier.trim(),
      input.issueTitle.trim(),
      input.issueStatus.trim(),
      toOptionalString(input.issueAssignee ?? null),
      threadId,
      input.agentId.trim(),
      input.agentName.trim(),
      mode,
      toOptionalString(input.recapFilePath ?? null),
      now,
      now
    );

    const row = db
      .prepare(`${JOINED_SELECT} WHERE tr.id = ? LIMIT 1`)
      .get(id) as JoinedTrackerRunRow | undefined;

    if (!row) {
      throw new Error(`Failed to create tracker run ${id}`);
    }

    return mapRow(row);
  });
}

export async function updateTrackerRun(input: {
  id: string;
  rootMessageId?: string | null;
  chatRunId?: string | null;
  status?: TrackerRunStatus;
  error?: string | null;
}): Promise<TrackerRunRecord | null> {
  return withTrackerRunDatabase((db) => {
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

    db.prepare(`UPDATE tracker_runs SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    const row = db
      .prepare(`${JOINED_SELECT} WHERE tr.id = ? LIMIT 1`)
      .get(input.id.trim()) as JoinedTrackerRunRow | undefined;

    return row ? mapRow(row) : null;
  });
}

export async function getTrackerRun(id: string): Promise<TrackerRunRecord | null> {
  return withTrackerRunDatabase((db) => {
    const row = db
      .prepare(`${JOINED_SELECT} WHERE tr.id = ? LIMIT 1`)
      .get(id.trim()) as JoinedTrackerRunRow | undefined;
    return row ? mapRow(row) : null;
  });
}

export async function listTrackerRuns(input: {
  issueId: string;
  projectId?: string | null;
  trackerType?: string;
  limit?: number;
}): Promise<TrackerRunRecord[]> {
  const issueId = input.issueId.trim();
  const projectId = toOptionalString(input.projectId ?? null);
  const trackerType = toOptionalString(input.trackerType ?? null);
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(Number(input.limit), 1), 100)
    : 50;

  return withTrackerRunDatabase((db) => {
    const params: Array<string | number> = [issueId];
    const clauses = ["tr.issue_id = ?"];

    if (projectId) {
      clauses.push("tr.project_id = ?");
      params.push(projectId);
    }
    if (trackerType) {
      clauses.push("tr.tracker_type = ?");
      params.push(trackerType);
    }

    params.push(limit);

    const rows = db
      .prepare(
        `${JOINED_SELECT}
         WHERE ${clauses.join(" AND ")}
         ORDER BY tr.created_at DESC
         LIMIT ?`
      )
      .all(...params) as unknown as JoinedTrackerRunRow[];

    return rows.map(mapRow);
  });
}

export async function getIssueActivityMap(
  projectId?: string | null
): Promise<Map<string, string>> {
  return withTrackerRunDatabase((db) => {
    const hasProject = projectId?.trim();
    const sql = hasProject
      ? `SELECT issue_id, MAX(created_at) AS last_activity_at
         FROM tracker_runs
         WHERE project_id = ?
         GROUP BY issue_id`
      : `SELECT issue_id, MAX(created_at) AS last_activity_at
         FROM tracker_runs
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

export interface IssueStats {
  issueId: string;
  sessions: number;
  messages: number;
}

export async function getIssueStats(
  projectId?: string | null
): Promise<IssueStats[]> {
  return withTrackerRunDatabase((db) => {
    const hasProject = projectId?.trim();
    const sql = hasProject
      ? `SELECT tr.issue_id,
                COUNT(DISTINCT tr.id) AS sessions,
                COALESCE(SUM(mc.cnt), 0) AS messages
         FROM tracker_runs tr
         LEFT JOIN (
           SELECT thread_id, COUNT(*) AS cnt FROM messages GROUP BY thread_id
         ) mc ON mc.thread_id = tr.thread_id
         WHERE tr.project_id = ?
         GROUP BY tr.issue_id`
      : `SELECT tr.issue_id,
                COUNT(DISTINCT tr.id) AS sessions,
                COALESCE(SUM(mc.cnt), 0) AS messages
         FROM tracker_runs tr
         LEFT JOIN (
           SELECT thread_id, COUNT(*) AS cnt FROM messages GROUP BY thread_id
         ) mc ON mc.thread_id = tr.thread_id
         GROUP BY tr.issue_id`;

    const rows = hasProject
      ? (db.prepare(sql).all(projectId!.trim()) as unknown as Array<{ issue_id: string; sessions: number; messages: number }>)
      : (db.prepare(sql).all() as unknown as Array<{ issue_id: string; sessions: number; messages: number }>);

    return rows.map((row) => ({
      issueId: row.issue_id,
      sessions: row.sessions,
      messages: row.messages,
    }));
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
  return withTrackerRunDatabase((db) => {
    const hasProject = projectId?.trim();
    const sql = hasProject
      ? `SELECT DISTINCT tr.issue_id, tr.agent_id, tr.agent_name
         FROM tracker_runs tr
         INNER JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = tr.thread_id ORDER BY updated_at DESC LIMIT 1
         )
         WHERE cr.status IN ('queued', 'running')
           AND tr.project_id = ?`
      : `SELECT DISTINCT tr.issue_id, tr.agent_id, tr.agent_name
         FROM tracker_runs tr
         INNER JOIN chat_runs cr ON cr.id = (
           SELECT id FROM chat_runs WHERE thread_id = tr.thread_id ORDER BY updated_at DESC LIMIT 1
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

// --- Backward-compatible aliases ---

export type LinearRunStatus = TrackerRunStatus;
export type LinearRunMode = TrackerRunMode;
export type LinearRunRecord = TrackerRunRecord;

export const createLinearRun = createTrackerRun;
export const updateLinearRun = updateTrackerRun;
export const getLinearRun = getTrackerRun;
export const listLinearRuns = listTrackerRuns;
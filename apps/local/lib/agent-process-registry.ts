import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaSet } from "./sqlite-compat";
import path from "path";
import os from "os";
import { mkdirSync, existsSync } from "fs";

const HISTORY_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(HISTORY_DIR, "history.sqlite");

export interface AgentProcessEntry {
  id: number;
  workspaceId: string;
  threadId: string;
  agentId: string;
  pid: number;
  state: "spawning" | "running" | "done" | "error" | "killed";
  sinceMessageId: string;
  responseMessageId: string;
  startedAt: number;
  lastActivity: number;
  projectSlug: string;
}

interface Row {
  id: number;
  workspace_id: string;
  thread_id: string;
  agent_id: string;
  pid: number;
  state: string;
  since_message_id: string;
  response_message_id: string;
  started_at: number;
  last_activity: number;
  project_slug: string;
}

function toEntry(row: Row): AgentProcessEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    pid: row.pid,
    state: row.state as AgentProcessEntry["state"],
    sinceMessageId: row.since_message_id,
    responseMessageId: row.response_message_id || "",
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    projectSlug: row.project_slug || "",
  };
}

function getDb(): DatabaseSync {
  mkdirSync(HISTORY_DIR, { recursive: true });
  const db = new DatabaseSyncCtor(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_processes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      thread_id    TEXT NOT NULL DEFAULT '',
      agent_id     TEXT NOT NULL,
      pid          INTEGER NOT NULL DEFAULT 0,
      state        TEXT NOT NULL DEFAULT 'spawning',
      since_message_id TEXT NOT NULL DEFAULT '',
      started_at   INTEGER NOT NULL,
      last_activity INTEGER NOT NULL,
      project_slug TEXT NOT NULL DEFAULT '',
      UNIQUE (workspace_id, agent_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_processes_state ON agent_processes (state)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_processes_thread ON agent_processes (thread_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_processes_workspace ON agent_processes (workspace_id)");
  // Migration: add project_slug column if missing
  try {
    db.exec("ALTER TABLE agent_processes ADD COLUMN project_slug TEXT NOT NULL DEFAULT ''");
  } catch { /* column already exists */ }
  // Migration: add response_message_id column if missing
  try {
    db.exec("ALTER TABLE agent_processes ADD COLUMN response_message_id TEXT NOT NULL DEFAULT ''");
  } catch { /* column already exists */ }
  // Ensure joined tables exist so getAllEnriched() doesn't fail on a fresh DB
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      thread_id TEXT NOT NULL,
      id TEXT NOT NULL,
      role TEXT NOT NULL,
      participant_id TEXT,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (thread_id, id)
    )
  `);
  // Migrate: rename linear_runs → tracker_runs if old table exists and new one doesn't
  const hasOldTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='linear_runs'"
  ).get() as { name: string } | undefined);
  const hasNewTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tracker_runs'"
  ).get() as { name: string } | undefined);
  if (hasOldTable && !hasNewTable) {
    db.exec("ALTER TABLE linear_runs RENAME TO tracker_runs");
  } else if (hasOldTable && hasNewTable) {
    // Both exist (likely a partial prior migration) — drop the stale old table
    db.exec("DROP TABLE linear_runs");
  }
  db.exec(`
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  // Ensure tracker_type exists on renamed tables that predate the column
  const cols = db.prepare("PRAGMA table_info(tracker_runs)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "tracker_type")) {
    db.exec("ALTER TABLE tracker_runs ADD COLUMN tracker_type TEXT NOT NULL DEFAULT 'linear'");
  }
  return db;
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function register(entry: Omit<AgentProcessEntry, "id">): number {
  return withDb((db) => {
    const result = db.prepare(
      `INSERT INTO agent_processes (workspace_id, thread_id, agent_id, pid, state, since_message_id, response_message_id, started_at, last_activity, project_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, agent_id)
       DO UPDATE SET
         thread_id = excluded.thread_id,
         pid = excluded.pid,
         state = excluded.state,
         since_message_id = excluded.since_message_id,
         response_message_id = excluded.response_message_id,
         started_at = excluded.started_at,
         last_activity = excluded.last_activity,
         project_slug = excluded.project_slug`
    ).run(
      entry.workspaceId,
      entry.threadId,
      entry.agentId,
      entry.pid,
      entry.state,
      entry.sinceMessageId,
      entry.responseMessageId || "",
      entry.startedAt,
      entry.lastActivity,
      entry.projectSlug || ""
    );
    // On INSERT, lastInsertRowid is the new id.
    // On UPDATE (conflict), we need to fetch the existing id.
    if (result.changes === 1 && result.lastInsertRowid) {
      return Number(result.lastInsertRowid);
    }
    const row = db.prepare(
      "SELECT id FROM agent_processes WHERE workspace_id = ? AND agent_id = ?"
    ).get(entry.workspaceId, entry.agentId) as { id: number } | undefined;
    return row?.id ?? 0;
  });
}

export function update(
  workspaceId: string,
  agentId: string,
  patch: Partial<Pick<AgentProcessEntry, "state" | "lastActivity" | "pid">>
): void {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (patch.state !== undefined) {
    sets.push("state = ?");
    values.push(patch.state);
  }
  if (patch.lastActivity !== undefined) {
    sets.push("last_activity = ?");
    values.push(patch.lastActivity);
  }
  if (patch.pid !== undefined) {
    sets.push("pid = ?");
    values.push(patch.pid);
  }

  if (sets.length === 0) return;

  withDb((db) =>
    db.prepare(
      `UPDATE agent_processes SET ${sets.join(", ")} WHERE workspace_id = ? AND agent_id = ?`
    ).run(...values, workspaceId, agentId)
  );
}

export function remove(workspaceId: string, agentId: string): void {
  withDb((db) =>
    db.prepare("DELETE FROM agent_processes WHERE workspace_id = ? AND agent_id = ?").run(
      workspaceId,
      agentId
    )
  );
}

export function getByThread(threadId: string): AgentProcessEntry[] {
  return withDb((db) => {
    const rows = db
      .prepare("SELECT * FROM agent_processes WHERE thread_id = ?")
      .all(threadId) as unknown as Row[];
    return rows.map(toEntry);
  });
}

export function getByWorkspace(workspaceId: string): AgentProcessEntry[] {
  return withDb((db) => {
    const rows = db
      .prepare("SELECT * FROM agent_processes WHERE workspace_id = ?")
      .all(workspaceId) as unknown as Row[];
    return rows.map(toEntry);
  });
}

export function getAll(): AgentProcessEntry[] {
  return withDb((db) => {
    const rows = db.prepare("SELECT * FROM agent_processes").all() as unknown as Row[];
    return rows.map(toEntry);
  });
}

export interface EnrichedProcessEntry extends AgentProcessEntry {
  threadTitle: string | null;
  trackerItemId: string | null;
  trackerRunId: string | null;
  trackerType: string | null;
  /** @deprecated Use trackerItemId */
  linearIssueId: string | null;
  /** @deprecated Use trackerRunId */
  linearRunId: string | null;
}

export function getAllEnriched(): EnrichedProcessEntry[] {
  return withDb((db) => {
    const rows = db.prepare(`
      SELECT ap.*, substr(m.content, 1, 120) AS thread_title,
             tr.issue_id AS tracker_item_id, tr.id AS tracker_run_id,
             tr.tracker_type AS tracker_type
      FROM agent_processes ap
      LEFT JOIN messages m ON m.id = ap.thread_id AND m.thread_id = ap.workspace_id
      LEFT JOIN tracker_runs tr ON tr.chat_run_id = ap.id
    `).all() as unknown as (Row & { thread_title: string | null; tracker_item_id: string | null; tracker_run_id: string | null; tracker_type: string | null })[];
    return rows.map((r) => ({
      ...toEntry(r),
      threadTitle: r.thread_title,
      trackerItemId: r.tracker_item_id ?? null,
      trackerRunId: r.tracker_run_id ?? null,
      trackerType: r.tracker_type ?? null,
      // Deprecated aliases
      linearIssueId: r.tracker_item_id ?? null,
      linearRunId: r.tracker_run_id ?? null,
    }));
  });
}

function killEntries(entries: AgentProcessEntry[]): number {
  let killed = 0;
  for (const entry of entries) {
    if (entry.pid > 0) {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        // process may already be dead
      }
    }
    killed++;
  }
  return killed;
}

export function killByThread(threadId: string): number {
  const entries = getByThread(threadId).filter(
    (e) => e.state === "running" || e.state === "spawning"
  );
  const killed = killEntries(entries);

  if (killed > 0) {
    withDb((db) =>
      db.prepare(
        `UPDATE agent_processes SET state = 'killed', last_activity = ?
         WHERE thread_id = ? AND state IN ('running', 'spawning')`
      ).run(Date.now(), threadId)
    );
  }

  return killed;
}

export function killByWorkspace(workspaceId: string): number {
  const entries = getByWorkspace(workspaceId).filter(
    (e) => e.state === "running" || e.state === "spawning"
  );
  const killed = killEntries(entries);

  if (killed > 0) {
    withDb((db) =>
      db.prepare(
        `UPDATE agent_processes SET state = 'killed', last_activity = ?
         WHERE workspace_id = ? AND state IN ('running', 'spawning')`
      ).run(Date.now(), workspaceId)
    );
  }

  return killed;
}

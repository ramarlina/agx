import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { pragmaAll, pragmaSet, transaction, transactionFn } from "./sqlite-compat";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type {
  GroupMessage,
  MessageReaction,
  MessageSearchResult,
  ReactionType,
  ThreadInfo,
} from "./types";

const HISTORY_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(HISTORY_DIR, "history.sqlite");
const LEGACY_THREAD_ID = "global";
const REACTION_TYPES = new Set<ReactionType>([
  "ack",
  "working",
  "done",
  "clarify",
  "blocked",
]);
const ACTIVE_AGENT_PROCESS_STALE_MS = 10 * 60 * 1000;
const ACTIVE_CHAT_RUN_STALE_MS = 10 * 60 * 1000;
const ALLOWED_TRANSITIONS: Record<ReactionType, Set<ReactionType>> = {
  ack: new Set<ReactionType>(["ack", "working"]),
  working: new Set<ReactionType>(["ack", "working", "done", "clarify", "blocked"]),
  done: new Set<ReactionType>(["done", "ack", "working"]),
  clarify: new Set<ReactionType>(["ack", "clarify", "working"]),
  blocked: new Set<ReactionType>(["ack", "blocked", "working"]),
};

export class ReactionStoreError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ReactionStoreError";
    this.status = status;
  }
}

interface ReactionRow {
  message_id: string;
  participant_id: string;
  type: ReactionType;
}

interface SetReactionInput {
  threadId: string;
  messageId: string;
  participantId: string;
  type: ReactionType;
  reason?: string | null;
  blockerCode?: string | null;
  hostPid?: number | null;
  responseMessageId?: string | null;
}

interface SetReactionResult {
  updated: boolean;
  reactions: MessageReaction[];
}

interface SweepStaleWorkingResult {
  updated: number;
}

interface SearchMessagesInput {
  query: string;
  threadId?: string | null;
  threadIds?: string[] | null;
  limit?: number;
  offset?: number;
}

interface SearchMessagesResult {
  results: MessageSearchResult[];
  total: number;
}

interface SearchRow {
  thread_id: string;
  id: string;
  role: "user" | "assistant";
  participant_id: string | null;
  timestamp: number;
  root_message_id: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  participant_id: string | null;
  content: string;
  timestamp: number;
  root_message_id: string | null;
  parent_message_id: string | null;
  depth: number;
  thread_status: string | null;
  outcome_note: string | null;
}

export type ThreadProcessStatus = "running" | "done" | "failed";

export interface ThreadStatusProcess {
  processId: number | null;
  datetime: number;
  agent: string;
  responseTo: string;
  responseToMessageId: string;
  responseToSenderName: string;
  responseToSenderRole: GroupMessage["role"];
  responseMessageId: string | null;
  responseContent: string | null;
  status: ThreadProcessStatus;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  participantId: string | null;
  content: string;
  timestamp: number;
  parentMessageId: string | null;
  // For assistant messages only:
  processId: number | null;
  status: ThreadProcessStatus | null;
}

interface GetThreadStatusSnapshotInput {
  rootMessageId?: string;
  threadId?: string;
  messageLimit?: number;
  processLimit?: number;
}

export type ChatRunStatus =
  | "queued"
  | "running"
  | "awaiting_user"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type ChatRunStepStatus = "queued" | "running" | "completed" | "failed";

export interface ChatRunRecord {
  id: string;
  threadId: string;
  rootMessageId: string | null;
  userId: string;
  projectSlug: string | null;
  status: ChatRunStatus;
  currentStep: number;
  maxSteps: number;
  stepsUsed: number;
  lastError: string | null;
  activeParticipantIds: string[];
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface ChatRunStepRecord {
  id: string;
  chatRunId: string;
  stepIndex: number;
  kind: string;
  status: ChatRunStepStatus;
  participantId: string | null;
  inputPayload: Record<string, unknown> | null;
  outputPayload: Record<string, unknown> | null;
  startedAt: number;
  completedAt: number | null;
}

interface ChatRunRow {
  id: string;
  thread_id: string;
  root_message_id: string | null;
  user_id: string;
  project_slug: string | null;
  status: ChatRunStatus;
  current_step: number;
  max_steps: number;
  steps_used: number;
  last_error: string | null;
  active_participant_ids: string;
  payload_json: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface ChatRunStepRow {
  id: string;
  chat_run_id: string;
  step_index: number;
  kind: string;
  status: ChatRunStepStatus;
  participant_id: string | null;
  input_payload_json: string | null;
  output_payload_json: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface ThreadStatusSnapshot {
  rootMessage: GroupMessage | null;
  processes: ThreadStatusProcess[];
  messages: ThreadMessage[];
  lastUpdatedAt: number | null;
}

function hasSqliteObject(db: DatabaseSync, type: "table" | "trigger", name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1`)
    .get(type, name);
  return Boolean(row);
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (!Number.isFinite(pid) || !pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function initializeMessageSearch(db: DatabaseSync): void {
  const hasFtsTable = hasSqliteObject(db, "table", "messages_fts");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  const messageCount = (db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as { count: number })
    .count;
  if (messageCount === 0) return;

  const ftsCount = (
    db.prepare(`SELECT COUNT(*) as count FROM messages_fts`).get() as { count: number }
  ).count;
  const shouldBackfill = !hasFtsTable || ftsCount === 0;

  if (shouldBackfill) {
    db.exec(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;`);
  }
}

function isThreadScopedTable(db: DatabaseSync, tableName: string): boolean {
  const columns = pragmaAll(db, `table_info(${tableName})`) as Array<{ name: string }>;
  return columns.some((column) => column.name === "thread_id");
}

function migrateThreadReplyColumns(db: DatabaseSync): void {
  const columns = pragmaAll(db, `table_info(messages)`) as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has("root_message_id")) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN root_message_id TEXT;
      ALTER TABLE messages ADD COLUMN parent_message_id TEXT;
      ALTER TABLE messages ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_messages_root ON messages(thread_id, root_message_id);
    `);
  }
}

function migrateThreadStatusColumns(db: DatabaseSync): void {
  const columns = pragmaAll(db, `table_info(messages)`) as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has("thread_status")) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN thread_status TEXT;
      ALTER TABLE messages ADD COLUMN outcome_note TEXT;
    `);
  }
}

function migrateReactionHostPidColumn(db: DatabaseSync): void {
  const columns = pragmaAll(db, `table_info(message_reactions)`) as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has("host_pid")) {
    db.exec(`ALTER TABLE message_reactions ADD COLUMN host_pid INTEGER`);
  }
  if (!colNames.has("response_message_id")) {
    db.exec(`ALTER TABLE message_reactions ADD COLUMN response_message_id TEXT`);
  }
}

function migrateLogsToAgentProcessId(db: DatabaseSync): void {
  const columns = pragmaAll(db, `table_info(logs)`) as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  // Already migrated if agent_process_id exists
  if (colNames.has("agent_process_id")) return;
  // Old schema had thread_id + participant_id — drop and recreate
  // (logs are ephemeral, losing old data is acceptable)
  db.exec(`
    DROP TABLE IF EXISTS logs;
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_process_id INTEGER NOT NULL,
      stream TEXT NOT NULL,
      line TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
}

function migrateAgentProcessesAddId(db: DatabaseSync): void {
  const columns = pragmaAll(db, `table_info(agent_processes)`) as Array<{ name: string }>;
  if (columns.length === 0) return; // table doesn't exist yet, DDL will create it
  const colNames = new Set(columns.map((c) => c.name));
  if (colNames.has("id")) return; // already has id column
  // Recreate with id column (data is ephemeral, safe to drop)
  db.exec(`
    DROP TABLE IF EXISTS agent_processes;
    CREATE TABLE agent_processes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      thread_id    TEXT NOT NULL DEFAULT '',
      agent_id     TEXT NOT NULL,
      pid          INTEGER NOT NULL DEFAULT 0,
      state        TEXT NOT NULL DEFAULT 'spawning',
      since_message_id TEXT NOT NULL DEFAULT '',
      started_at   INTEGER NOT NULL DEFAULT 0,
      last_activity INTEGER NOT NULL DEFAULT 0,
      project_slug TEXT NOT NULL DEFAULT '',
      UNIQUE (workspace_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_processes_state ON agent_processes (state);
    CREATE INDEX IF NOT EXISTS idx_agent_processes_thread ON agent_processes (thread_id);
    CREATE INDEX IF NOT EXISTS idx_agent_processes_workspace ON agent_processes (workspace_id);
  `);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toChatRunRecord(row: ChatRunRow): ChatRunRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    rootMessageId: row.root_message_id,
    userId: row.user_id,
    projectSlug: row.project_slug,
    status: row.status,
    currentStep: row.current_step,
    maxSteps: row.max_steps,
    stepsUsed: row.steps_used,
    lastError: row.last_error,
    activeParticipantIds: parseJsonStringArray(row.active_participant_ids),
    payload: parseJsonObject(row.payload_json),
    result: parseJsonObject(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toChatRunStepRecord(row: ChatRunStepRow): ChatRunStepRecord {
  return {
    id: row.id,
    chatRunId: row.chat_run_id,
    stepIndex: row.step_index,
    kind: row.kind,
    status: row.status,
    participantId: row.participant_id,
    inputPayload: parseJsonObject(row.input_payload_json),
    outputPayload: parseJsonObject(row.output_payload_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function migrateLegacyTables(db: DatabaseSync): void {
  if (!isThreadScopedTable(db, "messages")) {
    db.exec(`
      ALTER TABLE messages RENAME TO messages_legacy;
      CREATE TABLE messages (
        thread_id TEXT NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        participant_id TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (thread_id, id)
      );
      INSERT INTO messages (thread_id, id, role, participant_id, content, timestamp)
      SELECT '${LEGACY_THREAD_ID}', id, role, participant_id, content, timestamp
      FROM messages_legacy;
      DROP TABLE messages_legacy;
    `);
  }

  if (!isThreadScopedTable(db, "message_reactions")) {
    db.exec(`
      ALTER TABLE message_reactions RENAME TO message_reactions_legacy;
      CREATE TABLE message_reactions (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT,
        blocker_code TEXT,
        host_pid INTEGER,
        response_message_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, message_id, participant_id)
      );
      INSERT INTO message_reactions (thread_id, message_id, participant_id, type, reason, blocker_code, host_pid, updated_at)
      SELECT '${LEGACY_THREAD_ID}', message_id, participant_id, type, reason, blocker_code, NULL, updated_at
      FROM message_reactions_legacy;
      DROP TABLE message_reactions_legacy;
    `);
  }

  // Migrate logs to agent_process_id schema
  migrateLogsToAgentProcessId(db);
}

const withDatabase = async <T>(run: (db: DatabaseSync) => T): Promise<T> => {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        participant_id TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (thread_id, id)
      );
      CREATE TABLE IF NOT EXISTS message_reactions (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT,
        blocker_code TEXT,
        host_pid INTEGER,
        response_message_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, message_id, participant_id)
      );
      CREATE TABLE IF NOT EXISTS agent_processes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        thread_id    TEXT NOT NULL DEFAULT '',
        agent_id     TEXT NOT NULL,
        pid          INTEGER NOT NULL DEFAULT 0,
        state        TEXT NOT NULL DEFAULT 'spawning',
        since_message_id TEXT NOT NULL DEFAULT '',
        started_at   INTEGER NOT NULL DEFAULT 0,
        last_activity INTEGER NOT NULL DEFAULT 0,
        project_slug TEXT NOT NULL DEFAULT '',
        UNIQUE (workspace_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_process_id INTEGER NOT NULL,
        stream TEXT NOT NULL,
        line TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
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
      CREATE TABLE IF NOT EXISTS chat_run_steps (
        id TEXT PRIMARY KEY,
        chat_run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        participant_id TEXT,
        input_payload_json TEXT,
        output_payload_json TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS thread_repo_selections (
        thread_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        PRIMARY KEY (thread_id, repo_id)
      );
    `);
    migrateLegacyTables(db);
    migrateThreadReplyColumns(db);
    migrateThreadStatusColumns(db);
    migrateReactionHostPidColumn(db);
    // Rename thread_status "parked" → "in-review"
    db.exec("UPDATE messages SET thread_status = 'in-review' WHERE thread_status = 'parked'");
    // Rename thread_status "thinking" → "active", "resolved" → "done"
    db.exec("UPDATE messages SET thread_status = 'active' WHERE thread_status = 'thinking'");
    db.exec("UPDATE messages SET thread_status = 'done' WHERE thread_status = 'resolved'");
    // Remove "converged" status — migrate to "active"
    db.exec("UPDATE messages SET thread_status = 'active' WHERE thread_status = 'converged'");
    migrateAgentProcessesAddId(db);
    initializeMessageSearch(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON messages(thread_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_reactions_thread_message ON message_reactions(thread_id, message_id, updated_at ASC);
      CREATE INDEX IF NOT EXISTS idx_logs_process_ts ON logs(agent_process_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_chat_runs_thread_updated ON chat_runs(thread_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_runs_status_updated ON chat_runs(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_run_steps_run_step ON chat_run_steps(chat_run_id, step_index ASC);
    `);
    return run(db);
  } finally {
    db.close();
  }
};

function aggregateReactionRows(rows: ReactionRow[]): Map<string, MessageReaction[]> {
  const perMessage = new Map<string, Map<ReactionType, MessageReaction>>();

  for (const row of rows) {
    let byType = perMessage.get(row.message_id);
    if (!byType) {
      byType = new Map<ReactionType, MessageReaction>();
      perMessage.set(row.message_id, byType);
    }

    let reaction = byType.get(row.type);
    if (!reaction) {
      reaction = { type: row.type, count: 0, participantIds: [] };
      byType.set(row.type, reaction);
    }

    reaction.count += 1;
    reaction.participantIds.push(row.participant_id);
  }

  const out = new Map<string, MessageReaction[]>();
  for (const [messageId, byType] of perMessage.entries()) {
    const sorted = Array.from(byType.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.type.localeCompare(b.type);
    });
    out.set(messageId, sorted);
  }
  return out;
}

function loadMessageReactions(
  db: DatabaseSync,
  threadId: string,
  messageIds?: string[]
): Map<string, MessageReaction[]> {
  if (messageIds && messageIds.length === 0) return new Map();

  if (messageIds) {
    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT message_id, participant_id, type
         FROM message_reactions
         WHERE thread_id = ? AND message_id IN (${placeholders})
         ORDER BY updated_at ASC`
      )
      .all(threadId, ...messageIds) as unknown as ReactionRow[];
    return aggregateReactionRows(rows);
  }

  const rows = db
    .prepare(
      `SELECT message_id, participant_id, type
       FROM message_reactions
       WHERE thread_id = ?
       ORDER BY updated_at ASC`
    )
    .all(threadId) as unknown as ReactionRow[];
  return aggregateReactionRows(rows);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalHostPid(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function isAllowedTransition(from: ReactionType | null, to: ReactionType): boolean {
  if (!from) return true;
  return ALLOWED_TRANSITIONS[from].has(to);
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number = 100): number {
  const normalized = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(Math.max(Math.trunc(normalized), 1), max);
}

function tokenizeSearchTerms(query: string): string[] {
  const matches = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of matches) {
    if (seen.has(match)) continue;
    seen.add(match);
    tokens.push(match);
  }
  return tokens;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchSnippet(content: string, terms: string[]): string {
  const compact = stripAgxMarkers(content).replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const searchTerms = terms.filter(Boolean);
  const lowerContent = compact.toLowerCase();
  const firstMatchIndex = searchTerms.reduce((best, term) => {
    const index = lowerContent.indexOf(term);
    if (index === -1) return best;
    if (best === -1 || index < best) return index;
    return best;
  }, -1);

  const start = firstMatchIndex >= 0 ? Math.max(0, firstMatchIndex - 48) : 0;
  const end = firstMatchIndex >= 0 ? Math.min(compact.length, firstMatchIndex + 112) : Math.min(compact.length, 160);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  const excerpt = `${prefix}${compact.slice(start, end)}${suffix}`;

  if (searchTerms.length === 0) return excerpt;

  const pattern = new RegExp(`(${searchTerms.map(escapeRegExp).join("|")})`, "giu");
  return excerpt.replace(pattern, "<mark>$1</mark>");
}

function toGroupMessage(row: MessageRow, reactionMap: Map<string, MessageReaction[]>): GroupMessage {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    participantId: row.participant_id,
    content: row.content,
    timestamp: row.timestamp,
    reactions: reactionMap.get(row.id),
    rootMessageId: row.root_message_id,
    parentMessageId: row.parent_message_id,
    depth: row.depth,
    ...(row.thread_status ? { threadStatus: row.thread_status as GroupMessage["threadStatus"] } : {}),
    ...(row.outcome_note ? { outcomeNote: row.outcome_note } : {}),
  };
}

function stripAgxMarkers(content: string): string {
  return content
    .replace(/\[agx:spawn\]\s*/g, "")
    .replace(/\s*\[agx:exit:\d+\]\s*/g, "")
    .replace(/^\[SKIP\]\s*$/gm, "")
    .trim();
}

function mapReactionTypeToProcessStatus(type: ReactionType): ThreadProcessStatus | null {
  if (type === "working") return "running";
  if (type === "done") return "done";
  if (type === "blocked" || type === "clarify") return "failed";
  return null;
}

export interface RootMessageRow {
  thread_id: string;
  id: string;
  content: string;
  timestamp: number;
  thread_status: string | null;
  outcome_note: string | null;
  reply_count: number;
  last_activity: number;
}

export async function listRootMessages(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: RootMessageRow[]; total: number }> {
  const { status, limit = 20, offset = 0 } = options ?? {};
  return withDatabase((db) => {
    const where = [
      "m.root_message_id IS NULL",
      "m.depth = 0",
    ];
    const params: unknown[] = [];
    if (status) {
      where.push("COALESCE(m.thread_status, 'active') = ?");
      params.push(status);
    }
    const whereClause = where.join(" AND ");

    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM messages m WHERE ${whereClause}`)
      .get(...(params.length ? [params] : []).flat().map(v => v as SQLInputValue)) as { cnt: number };

    const rows = db
      .prepare(
        `SELECT m.thread_id, m.id, m.content, m.timestamp,
                m.thread_status, m.outcome_note,
                (SELECT COUNT(*) FROM messages r WHERE r.root_message_id = m.id AND r.thread_id = m.thread_id) as reply_count,
                COALESCE((SELECT MAX(r.timestamp) FROM messages r WHERE r.root_message_id = m.id AND r.thread_id = m.thread_id), m.timestamp) as last_activity
         FROM messages m
         WHERE ${whereClause}
         ORDER BY last_activity DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params.map(v => v as SQLInputValue), limit, offset) as unknown as RootMessageRow[];

    return { rows, total: countRow.cnt };
  });
}

export async function getWorkspaceNames(threadIds: string[]): Promise<Record<string, string>> {
  if (threadIds.length === 0) return {};
  // Project names live in the board DB, not the history DB.
  // Import lazily to avoid circular deps.
  const { getSQLiteDb } = await import("@/lib/sqlite-query-adapter");
  const db = getSQLiteDb();
  const placeholders = threadIds.map(() => "?").join(", ");

  // Primary: project_threads (new model)
  const rows = db
    .prepare(
      `SELECT pt.thread_id, p.name FROM project_threads pt
       JOIN projects p ON p.id = pt.project_id
       WHERE pt.thread_id IN (${placeholders})`
    )
    .all(...threadIds) as { thread_id: string; name: string }[];
  const names: Record<string, string> = {};
  for (const r of rows) {
    if (!names[r.thread_id]) {
      names[r.thread_id] = r.name;
    }
  }

  return names;
}

/**
 * Get thread_ids scoped to a project via the project_threads table.
 */
export async function getProjectThreadIds(projectId: string): Promise<string[]> {
  const { getSQLiteDb } = await import("@/lib/sqlite-query-adapter");
  const db = getSQLiteDb();
  const rows = db
    .prepare("SELECT thread_id FROM project_threads WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as { thread_id: string }[];
  return rows.map((r) => r.thread_id);
}

export async function loadHistory(threadId: string, since?: number): Promise<GroupMessage[]> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  return withDatabase((db) => {
    const query = since != null
      ? `SELECT id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
         FROM messages
         WHERE thread_id = ? AND timestamp > ?
         ORDER BY timestamp ASC`
      : `SELECT id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
         FROM messages
         WHERE thread_id = ?
         ORDER BY timestamp ASC`;
    const rows = (since != null
      ? db.prepare(query).all(normalizedThreadId, since)
      : db.prepare(query).all(normalizedThreadId)) as unknown as MessageRow[];
    const reactionMap = loadMessageReactions(
      db,
      normalizedThreadId,
      rows.map((r) => r.id)
    );
    return rows.map((row) => toGroupMessage(row, reactionMap));
  });
}

export async function getThreadStatusSnapshot(
  input: GetThreadStatusSnapshotInput
): Promise<ThreadStatusSnapshot> {
  const normalizedRootMessageId = normalizeOptionalText(input.rootMessageId);
  const requestedThreadId = input.threadId?.trim() || null;

  const processLimit = input.processLimit != null ? clampPositiveInt(input.processLimit, 10) : null;

  return withDatabase((db) => {
    if (!normalizedRootMessageId && !requestedThreadId) {
      return {
        rootMessage: null,
        processes: [],
        messages: [],
        lastUpdatedAt: null,
      };
    }

    const messageScopeRow =
      requestedThreadId && normalizedRootMessageId
        ? (db
            .prepare(
              `SELECT thread_id, id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
               FROM messages
               WHERE thread_id = ? AND id = ?
               LIMIT 1`
            )
            .get(requestedThreadId, normalizedRootMessageId) as
            | (MessageRow & { thread_id: string })
            | undefined)
        : requestedThreadId
          ? (db
              .prepare(
                `SELECT thread_id, id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
                 FROM messages
                 WHERE thread_id = ?
                 ORDER BY CASE WHEN root_message_id IS NULL THEN 0 ELSE 1 END, timestamp ASC, id ASC
                 LIMIT 1`
              )
              .get(requestedThreadId) as (MessageRow & { thread_id: string }) | undefined)
          : (db
              .prepare(
                `SELECT thread_id, id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
                 FROM messages
                 WHERE id = ?
                 ORDER BY timestamp ASC, thread_id ASC
                 LIMIT 1`
              )
              .get(normalizedRootMessageId!) as (MessageRow & { thread_id: string }) | undefined);

    if (!messageScopeRow) {
      return {
        rootMessage: null,
        processes: [],
        messages: [],
        lastUpdatedAt: null,
      };
    }

    const scopedThreadId = messageScopeRow.thread_id;
    const scopedRootMessageId = messageScopeRow.root_message_id ?? messageScopeRow.id;

    const rootCandidate = db
      .prepare(
        `SELECT id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note
         FROM messages
         WHERE thread_id = ? AND id = ?
         LIMIT 1`
      )
      .get(scopedThreadId, scopedRootMessageId) as unknown as MessageRow | undefined;

    if (!rootCandidate) {
      return {
        rootMessage: null,
        processes: [],
        messages: [],
        lastUpdatedAt: null,
      };
    }

    const reactionMap = loadMessageReactions(db, scopedThreadId, [scopedRootMessageId]);

    // Primary source: message_reactions — each reaction represents an agent process.
    // Join to the message being responded to, and use response_message_id to find response content.
    const processRows = db
      .prepare(
        `SELECT
            r.updated_at as datetime,
            r.participant_id as participant_id,
            r.type as type,
            r.host_pid as host_pid,
            r.message_id as response_to_message_id,
            m.content as response_to,
            m.role as response_to_role,
            m.participant_id as response_to_participant_id,
            r.response_message_id as response_message_id,
            resp.content as response_content
         FROM message_reactions r
         JOIN messages m
           ON m.id = r.message_id AND m.thread_id = r.thread_id
         LEFT JOIN messages resp
           ON resp.id = r.response_message_id AND resp.thread_id = r.thread_id
         WHERE r.thread_id = ?
           AND r.type IN ('working', 'done', 'clarify', 'blocked')
           AND (m.root_message_id = ? OR m.id = ?)
         ORDER BY r.updated_at DESC
         ${processLimit != null ? 'LIMIT ?' : ''}`
      )
      .all(...[scopedThreadId, scopedRootMessageId, scopedRootMessageId, ...(processLimit != null ? [processLimit] : [])]) as Array<{
      datetime: number;
      participant_id: string;
      type: ReactionType;
      host_pid: number | null;
      response_to_message_id: string | null;
      response_to: string | null;
      response_to_role: GroupMessage["role"] | null;
      response_to_participant_id: string | null;
      response_message_id: string | null;
      response_content: string | null;
    }>;

    const rootMessage = toGroupMessage(rootCandidate, reactionMap);
    const processes = processRows
      .map((row) => {
        const status = mapReactionTypeToProcessStatus(row.type);
        if (!status) return null;
        return {
          processId: normalizeOptionalHostPid(row.host_pid),
          datetime: row.datetime,
          agent: row.participant_id,
          responseTo: row.response_to ?? "",
          responseToMessageId: row.response_to_message_id ?? "",
          responseToSenderName:
            normalizeOptionalText(row.response_to_participant_id) ?? row.response_to_role ?? "",
          responseToSenderRole: row.response_to_role ?? "user",
          responseMessageId: normalizeOptionalText(row.response_message_id),
          responseContent: row.response_content,
          status,
        } satisfies ThreadStatusProcess;
      })
      .filter((row): row is ThreadStatusProcess => row !== null);

    // Also pull running/spawning processes from agent_processes table.
    // These may not have an assistant message yet, so the primary query misses them.
    const activeProcessRows = db
      .prepare(
        `SELECT ap.id, ap.agent_id, ap.pid, ap.state, ap.since_message_id, ap.started_at, ap.last_activity,
                m.content as response_to,
                m.role as response_to_role,
                m.participant_id as response_to_participant_id
         FROM agent_processes ap
         LEFT JOIN messages m
           ON m.id = ap.since_message_id AND m.thread_id = ap.workspace_id
         WHERE ap.thread_id = ?
           AND ap.state IN ('running', 'spawning')`
      )
      .all(scopedRootMessageId) as Array<{
      id: number;
      agent_id: string;
      pid: number;
      state: string;
      since_message_id: string;
      started_at: number;
      last_activity: number;
      response_to: string | null;
      response_to_role: string | null;
      response_to_participant_id: string | null;
    }>;

    const now = Date.now();
    const staleActiveProcessIds = activeProcessRows
      .filter((ap) => {
        const lastSeenAt = Math.max(ap.last_activity || 0, ap.started_at || 0);
        if (lastSeenAt > now - ACTIVE_AGENT_PROCESS_STALE_MS) return false;
        return !isPidAlive(ap.pid);
      })
      .map((ap) => ap.id);
    const staleActiveProcessIdSet = new Set(staleActiveProcessIds);

    if (staleActiveProcessIds.length > 0) {
      const markStale = db.prepare(
        `UPDATE agent_processes
         SET state = 'error',
             last_activity = ?
         WHERE id = ?`
      );
      const markManyStale = transactionFn(db, (ids: number[]) => {
        for (const id of ids) {
          markStale.run(now, id);
        }
      });
      markManyStale(staleActiveProcessIds);
    }

    // Merge: only add active processes not already represented
    const existingPids = new Set(processes.filter(p => p.processId != null).map(p => p.processId));
    const existingAgents = new Set(processes.filter(p => p.status === "running").map(p => p.agent));
    for (const ap of activeProcessRows) {
      if (staleActiveProcessIdSet.has(ap.id)) continue;
      if (existingPids.has(ap.pid) || existingAgents.has(ap.agent_id)) continue;
      processes.push({
        processId: ap.pid || null,
        datetime: ap.started_at,
        agent: ap.agent_id,
        responseTo: ap.response_to ?? "",
        responseToMessageId: ap.since_message_id ?? "",
        responseToSenderName:
          normalizeOptionalText(ap.response_to_participant_id) ?? ap.response_to_role ?? "user",
        responseToSenderRole: (ap.response_to_role ?? "user") as "user" | "assistant",
        responseMessageId: null,
        responseContent: null,
        status: "running",
      } satisfies ThreadStatusProcess);
    }

    // Fetch ALL messages in thread (user + assistant) for the threaded view
    const allMessageRows = db
      .prepare(
        `SELECT m.id, m.role, m.participant_id, m.content, m.timestamp,
                m.parent_message_id,
                r.host_pid, r.type as reaction_type
         FROM messages m
         LEFT JOIN message_reactions r
           ON r.thread_id = m.thread_id
          AND r.message_id = m.parent_message_id
          AND r.participant_id = m.participant_id
          AND r.type IN ('working', 'done', 'clarify', 'blocked')
         WHERE m.thread_id = ?
           AND (m.root_message_id = ? OR m.id = ?)
         ORDER BY m.timestamp ASC`
      )
      .all(scopedThreadId, scopedRootMessageId, scopedRootMessageId) as Array<{
      id: string;
      role: string;
      participant_id: string | null;
      content: string;
      timestamp: number;
      parent_message_id: string | null;
      host_pid: number | null;
      reaction_type: ReactionType | null;
    }>;

    const threadMessages: ThreadMessage[] = allMessageRows
      .filter((row) => {
        // Filter out [SKIP] messages
        const stripped = stripAgxMarkers(row.content);
        return stripped.trim().length > 0;
      })
      .map((row) => {
        let status: ThreadProcessStatus | null = null;
        if (row.role === "assistant") {
          if (row.reaction_type) {
            status = mapReactionTypeToProcessStatus(row.reaction_type);
          } else {
            status = "done"; // default for assistant messages with content
          }
        }
        return {
          id: row.id,
          role: row.role as "user" | "assistant",
          participantId: row.participant_id,
          content: stripAgxMarkers(row.content),
          timestamp: row.timestamp,
          parentMessageId: row.parent_message_id,
          processId: row.role === "assistant" ? normalizeOptionalHostPid(row.host_pid) : null,
          status,
        };
      });

    const timestamps: number[] = [];
    if (rootMessage) timestamps.push(rootMessage.timestamp);
    for (const process of processes) timestamps.push(process.datetime);
    for (const msg of threadMessages) timestamps.push(msg.timestamp);
    const lastUpdatedAt = timestamps.length > 0 ? Math.max(...timestamps) : null;

    return {
      rootMessage,
      processes,
      messages: threadMessages,
      lastUpdatedAt,
    };
  });
}

export async function saveMessages(threadId: string, messages: GroupMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  await withDatabase((db) => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO messages (thread_id, id, role, participant_id, content, timestamp, root_message_id, parent_message_id, depth, thread_status, outcome_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = transactionFn(db, (msgs: GroupMessage[]) => {
      for (const m of msgs) {
        stmt.run(normalizedThreadId, m.id, m.role, m.participantId, m.content, m.timestamp, m.rootMessageId ?? null, m.parentMessageId ?? null, m.depth ?? 0, m.threadStatus ?? null, m.outcomeNote ?? null);
      }
    });
    insertMany(messages);
  });
}

export async function createChatRun(input: {
  id: string;
  threadId: string;
  rootMessageId?: string | null;
  userId: string;
  projectSlug?: string | null;
  maxSteps: number;
  activeParticipantIds: string[];
  payload?: Record<string, unknown> | null;
}): Promise<ChatRunRecord> {
  const now = Date.now();
  return withDatabase((db) => {
    db.prepare(
      `INSERT INTO chat_runs (
        id, thread_id, root_message_id, user_id, project_slug, status,
        current_step, max_steps, steps_used, last_error, active_participant_ids,
        payload_json, result_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, 0, NULL, ?, ?, NULL, ?, ?, NULL)`
    ).run(
      input.id,
      input.threadId.trim() || LEGACY_THREAD_ID,
      normalizeOptionalText(input.rootMessageId),
      input.userId,
      normalizeOptionalText(input.projectSlug),
      clampPositiveInt(input.maxSteps, 10, 50),
      JSON.stringify(input.activeParticipantIds),
      input.payload ? JSON.stringify(input.payload) : null,
      now,
      now
    );

    const row = db.prepare("SELECT * FROM chat_runs WHERE id = ? LIMIT 1").get(input.id) as unknown as ChatRunRow | undefined;
    if (!row) {
      throw new Error(`Failed to create chat run ${input.id}`);
    }
    return toChatRunRecord(row);
  });
}

export async function sweepStaleChatRuns(input?: {
  threadId?: string | null;
  olderThanMs?: number;
}): Promise<number> {
  const normalizedThreadId = normalizeOptionalText(input?.threadId ?? null);
  const thresholdMs = Number.isFinite(input?.olderThanMs)
    ? Math.max(input!.olderThanMs!, 1)
    : ACTIVE_CHAT_RUN_STALE_MS;
  const now = Date.now();
  const cutoff = now - thresholdMs;

  return withDatabase((db) => {
    const clauses = ["status = 'running'", "updated_at <= ?"];
    const params: Array<string | number> = [cutoff];

    if (normalizedThreadId) {
      clauses.push("thread_id = ?");
      params.push(normalizedThreadId);
    }

    const result = db
      .prepare(
        `UPDATE chat_runs
         SET status = 'failed',
             last_error = COALESCE(NULLIF(last_error, ''), 'Worker process died mid-execution'),
             updated_at = ?,
             completed_at = COALESCE(completed_at, ?)
         WHERE ${clauses.join(" AND ")}`
      )
      .run(now, now, ...params);

    return Number(result.changes);
  });
}

export async function getChatRun(chatRunId: string): Promise<ChatRunRecord | null> {
  await sweepStaleChatRuns();
  return withDatabase((db) => {
    const row = db.prepare("SELECT * FROM chat_runs WHERE id = ? LIMIT 1").get(chatRunId) as unknown as ChatRunRow | undefined;
    return row ? toChatRunRecord(row) : null;
  });
}

export async function listChatRuns(input: {
  threadId?: string | null;
  status?: ChatRunStatus | "active";
  limit?: number;
}): Promise<ChatRunRecord[]> {
  await sweepStaleChatRuns({ threadId: input.threadId });
  const normalizedThreadId = normalizeOptionalText(input.threadId ?? null);
  const limit = clampPositiveInt(input.limit, 20, 100);
  return withDatabase((db) => {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (normalizedThreadId) {
      clauses.push("thread_id = ?");
      params.push(normalizedThreadId);
    }

    if (input.status === "active") {
      clauses.push("status IN ('queued', 'running')");
    } else if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM chat_runs ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit) as unknown as ChatRunRow[];
    return rows.map(toChatRunRecord);
  });
}

export async function updateChatRun(input: {
  id: string;
  status?: ChatRunStatus;
  currentStep?: number;
  stepsUsed?: number;
  lastError?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  completedAt?: number | null;
}): Promise<ChatRunRecord | null> {
  return withDatabase((db) => {
    const updates: string[] = ["updated_at = ?"];
    const params: Array<string | number | null> = [Date.now()];

    if (input.status) {
      updates.push("status = ?");
      params.push(input.status);
    }
    if (typeof input.currentStep === "number") {
      updates.push("current_step = ?");
      params.push(input.currentStep);
    }
    if (typeof input.stepsUsed === "number") {
      updates.push("steps_used = ?");
      params.push(input.stepsUsed);
    }
    if (input.lastError !== undefined) {
      updates.push("last_error = ?");
      params.push(normalizeOptionalText(input.lastError));
    }
    if (input.payload !== undefined) {
      updates.push("payload_json = ?");
      params.push(input.payload ? JSON.stringify(input.payload) : null);
    }
    if (input.result !== undefined) {
      updates.push("result_json = ?");
      params.push(input.result ? JSON.stringify(input.result) : null);
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ?");
      params.push(input.completedAt);
    }

    params.push(input.id);
    db.prepare(`UPDATE chat_runs SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    const row = db.prepare("SELECT * FROM chat_runs WHERE id = ? LIMIT 1").get(input.id) as unknown as ChatRunRow | undefined;
    return row ? toChatRunRecord(row) : null;
  });
}

export async function appendChatRunStep(input: {
  id: string;
  chatRunId: string;
  stepIndex: number;
  kind: string;
  status: ChatRunStepStatus;
  participantId?: string | null;
  inputPayload?: Record<string, unknown> | null;
  outputPayload?: Record<string, unknown> | null;
}): Promise<ChatRunStepRecord> {
  const now = Date.now();
  return withDatabase((db) => {
    db.prepare(
      `INSERT INTO chat_run_steps (
        id, chat_run_id, step_index, kind, status, participant_id,
        input_payload_json, output_payload_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.chatRunId,
      input.stepIndex,
      input.kind,
      input.status,
      normalizeOptionalText(input.participantId),
      input.inputPayload ? JSON.stringify(input.inputPayload) : null,
      input.outputPayload ? JSON.stringify(input.outputPayload) : null,
      now,
      input.status === "completed" || input.status === "failed" ? now : null
    );

    const row = db.prepare("SELECT * FROM chat_run_steps WHERE id = ? LIMIT 1").get(input.id) as unknown as ChatRunStepRow | undefined;
    if (!row) {
      throw new Error(`Failed to append chat run step ${input.id}`);
    }
    return toChatRunStepRecord(row);
  });
}

export async function updateChatRunStep(input: {
  id: string;
  status?: ChatRunStepStatus;
  outputPayload?: Record<string, unknown> | null;
  completedAt?: number | null;
}): Promise<ChatRunStepRecord | null> {
  return withDatabase((db) => {
    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (input.status) {
      updates.push("status = ?");
      params.push(input.status);
    }
    if (input.outputPayload !== undefined) {
      updates.push("output_payload_json = ?");
      params.push(input.outputPayload ? JSON.stringify(input.outputPayload) : null);
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ?");
      params.push(input.completedAt);
    }
    if (updates.length === 0) {
      const existing = db.prepare("SELECT * FROM chat_run_steps WHERE id = ? LIMIT 1").get(input.id) as unknown as ChatRunStepRow | undefined;
      return existing ? toChatRunStepRecord(existing) : null;
    }
    params.push(input.id);
    db.prepare(`UPDATE chat_run_steps SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    const row = db.prepare("SELECT * FROM chat_run_steps WHERE id = ? LIMIT 1").get(input.id) as unknown as ChatRunStepRow | undefined;
    return row ? toChatRunStepRecord(row) : null;
  });
}

export async function getActiveAgentsByThreads(
  threadIds: string[]
): Promise<Map<string, string[]>> {
  const filtered = threadIds.map((id) => id.trim()).filter(Boolean);
  if (filtered.length === 0) return new Map();

  return withDatabase((db) => {
    const placeholders = filtered.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT thread_id, active_participant_ids
         FROM chat_runs
         WHERE thread_id IN (${placeholders})
           AND status IN ('queued', 'running')`
      )
      .all(...filtered) as unknown as Array<{ thread_id: string; active_participant_ids: string }>;

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const ids = parseJsonStringArray(row.active_participant_ids);
      if (ids.length > 0) {
        const existing = map.get(row.thread_id) ?? [];
        for (const id of ids) {
          if (!existing.includes(id)) existing.push(id);
        }
        map.set(row.thread_id, existing);
      }
    }
    return map;
  });
}

export async function listChatRunSteps(chatRunId: string): Promise<ChatRunStepRecord[]> {
  return withDatabase((db) => {
    const rows = db
      .prepare("SELECT * FROM chat_run_steps WHERE chat_run_id = ? ORDER BY step_index ASC, started_at ASC")
      .all(chatRunId) as unknown as ChatRunStepRow[];
    return rows.map(toChatRunStepRecord);
  });
}

export async function updateMessageStatus(
  threadId: string,
  messageId: string,
  threadStatus: string | null,
  outcomeNote: string | null
): Promise<void> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  await withDatabase((db) => {
    db.prepare(
      `UPDATE messages SET thread_status = ?, outcome_note = ? WHERE thread_id = ? AND id = ?`
    ).run(threadStatus, outcomeNote, normalizedThreadId, messageId);
  });
}

export async function getMessageThread(messageId: string): Promise<{ threadId: string } | null> {
  return withDatabase((db) => {
    const row = db.prepare(`SELECT thread_id FROM messages WHERE id = ?`).get(messageId.trim()) as { thread_id: string } | undefined;
    return row ? { threadId: row.thread_id } : null;
  });
}

export async function clearHistory(threadId: string): Promise<void> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  await withDatabase((db) => {
    const tx = transactionFn(db, (id: string) => {
      db.prepare(`DELETE FROM message_reactions WHERE thread_id = ?`).run(id);
      db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(id);
    });
    tx(normalizedThreadId);
  });
}

export async function deleteMessage(threadId: string, messageId: string): Promise<void> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) return;

  await withDatabase((db) => {
    const tx = transactionFn(db, (thread: string, msgId: string) => {
      db.prepare(
        `DELETE FROM message_reactions WHERE thread_id = ? AND message_id = ?`
      ).run(thread, msgId);
      db.prepare(
        `DELETE FROM messages WHERE thread_id = ? AND id = ?`
      ).run(thread, msgId);
    });
    tx(normalizedThreadId, normalizedMessageId);
  });
}

export async function clearRootThread(threadId: string, rootMessageId: string): Promise<void> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  const normalizedRootMessageId = rootMessageId.trim();
  if (!normalizedRootMessageId) return;

  await withDatabase((db) => {
    const tx = transactionFn(db, (thread: string, rootId: string) => {
      db.prepare(
        `DELETE FROM message_reactions
         WHERE thread_id = ?
           AND message_id IN (
             SELECT id
             FROM messages
             WHERE thread_id = ?
               AND (id = ? OR root_message_id = ?)
           )`
      ).run(thread, thread, rootId, rootId);

      db.prepare(
        `DELETE FROM messages
         WHERE thread_id = ?
           AND (id = ? OR root_message_id = ?)`
      ).run(thread, rootId, rootId);
    });
    tx(normalizedThreadId, normalizedRootMessageId);
  });
}

export async function searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult> {
  const normalizedQuery = input.query.trim();
  if (!normalizedQuery) {
    return { results: [], total: 0 };
  }

  const normalizedThreadId =
    typeof input.threadId === "string" ? input.threadId.trim() || null : null;
  const normalizedThreadIds =
    normalizedThreadId || !Array.isArray(input.threadIds)
      ? []
      : Array.from(
          new Set(
            input.threadIds
              .map((threadId) => (typeof threadId === "string" ? threadId.trim() : ""))
              .filter(Boolean)
          )
        );
  const requestedLimit = Number.isFinite(input.limit) ? Number(input.limit) : 20;
  const requestedOffset = Number.isFinite(input.offset) ? Number(input.offset) : 0;
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
  const offset = Math.max(Math.trunc(requestedOffset), 0);
  const searchTerms = tokenizeSearchTerms(normalizedQuery);
  const ftsQuery = searchTerms.length > 0 ? searchTerms.map((term) => `${term}*`).join(" ") : null;

  if (!normalizedThreadId && Array.isArray(input.threadIds) && normalizedThreadIds.length === 0) {
    return { results: [], total: 0 };
  }

  return withDatabase((db) => {
    const merged = new Map<string, MessageSearchResult & { sortRank: number; matchedByFts: boolean }>();
    const buildThreadClauses = (columnName: string): { clause: string | null; params: string[] } => {
      if (normalizedThreadId) {
        return { clause: `${columnName} = ?`, params: [normalizedThreadId] };
      }
      if (normalizedThreadIds.length > 0) {
        return {
          clause: `${columnName} IN (${normalizedThreadIds.map(() => "?").join(", ")})`,
          params: normalizedThreadIds,
        };
      }
      return { clause: null, params: [] };
    };

    if (ftsQuery) {
      const ftsWhereClauses = ["messages_fts MATCH ?"];
      const ftsWhereParams: Array<string | number> = [ftsQuery];
      const threadFilter = buildThreadClauses("m.thread_id");
      if (threadFilter.clause) {
        ftsWhereClauses.push(threadFilter.clause);
        ftsWhereParams.push(...threadFilter.params);
      }

      const ftsRows = db
        .prepare(
          `SELECT m.thread_id, m.id, m.role, m.participant_id, m.timestamp, m.root_message_id,
                  snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
                  bm25(messages_fts) as rank
           FROM messages_fts
           JOIN messages m ON messages_fts.rowid = m.rowid
           WHERE ${ftsWhereClauses.join(" AND ")}
           ORDER BY rank ASC, m.timestamp DESC`
        )
        .all(...ftsWhereParams) as unknown as Array<SearchRow & { snippet: string; rank: number }>;

      for (const row of ftsRows) {
        const key = `${row.thread_id}:${row.id}`;
        merged.set(key, {
          threadId: row.thread_id,
          messageId: row.id,
          role: row.role,
          participantId: row.participant_id,
          snippet: row.snippet,
          timestamp: row.timestamp,
          rootMessageId: row.root_message_id,
          sortRank: row.rank,
          matchedByFts: true,
        });
      }
    }

    const fallbackClauses: string[] = [];
    const fallbackParams: Array<string | number> = [];
    const fallbackThreadFilter = buildThreadClauses("m.thread_id");
    if (fallbackThreadFilter.clause) {
      fallbackClauses.push(fallbackThreadFilter.clause);
      fallbackParams.push(...fallbackThreadFilter.params);
    }
    if (searchTerms.length > 0) {
      for (const term of searchTerms) {
        fallbackClauses.push("LOWER(m.content) LIKE ? ESCAPE '\\'");
        fallbackParams.push(`%${escapeLikePattern(term)}%`);
      }
    } else {
      fallbackClauses.push("LOWER(m.content) LIKE ? ESCAPE '\\'");
      fallbackParams.push(`%${escapeLikePattern(normalizedQuery.toLowerCase())}%`);
    }

    const fallbackRows = db
      .prepare(
        `SELECT m.thread_id, m.id, m.role, m.participant_id, m.content, m.timestamp, m.root_message_id
         FROM messages m
         WHERE ${fallbackClauses.join(" AND ")}
         ORDER BY m.timestamp DESC`
      )
      .all(...fallbackParams) as unknown as Array<SearchRow & { content: string }>;

    for (const row of fallbackRows) {
      const key = `${row.thread_id}:${row.id}`;
      if (merged.has(key)) continue;
      merged.set(key, {
        threadId: row.thread_id,
        messageId: row.id,
        role: row.role,
        participantId: row.participant_id,
        snippet: buildSearchSnippet(row.content, searchTerms),
        timestamp: row.timestamp,
        rootMessageId: row.root_message_id,
        sortRank: Number.POSITIVE_INFINITY,
        matchedByFts: false,
      });
    }

    const rows = Array.from(merged.values())
      .sort((a, b) => {
        if (a.matchedByFts !== b.matchedByFts) return a.matchedByFts ? -1 : 1;
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        return b.timestamp - a.timestamp;
      })
      .slice(offset, offset + limit);

    return {
      results: rows.map((row) => ({
        threadId: row.threadId,
        messageId: row.messageId,
        role: row.role,
        participantId: row.participantId,
        snippet: row.snippet,
        timestamp: row.timestamp,
        rootMessageId: row.rootMessageId,
      })),
      total: merged.size,
    };
  });
}

export async function setReaction(input: SetReactionInput): Promise<SetReactionResult> {
  const threadId = input.threadId?.trim() || LEGACY_THREAD_ID;
  const messageId = input.messageId?.trim();
  const participantId = input.participantId?.trim();
  const type = input.type;

  if (!messageId) {
    throw new ReactionStoreError("messageId is required", 400);
  }
  if (!participantId) {
    throw new ReactionStoreError("participantId is required", 400);
  }
  if (!REACTION_TYPES.has(type)) {
    throw new ReactionStoreError(`Invalid reaction type: ${String(type)}`, 400);
  }

  const incomingReason = normalizeOptionalText(input.reason);
  const incomingBlockerCode = normalizeOptionalText(input.blockerCode);
  const hostPid = normalizeOptionalHostPid(input.hostPid);
  const responseMessageId = normalizeOptionalText(input.responseMessageId);
  const needsReason = type === "clarify" || type === "blocked";

  if (needsReason && !incomingReason) {
    throw new ReactionStoreError(`"${type}" reactions require a reason`, 400);
  }
  const reason = needsReason ? incomingReason : null;
  const blockerCode = type === "blocked" ? incomingBlockerCode : null;

  return withDatabase((db) => {
    const messageExists = db
      .prepare(`SELECT 1 FROM messages WHERE thread_id = ? AND id = ? LIMIT 1`)
      .get(threadId, messageId);
    if (!messageExists) {
      throw new ReactionStoreError(`Message not found: ${messageId}`, 404);
    }

    const existing = db
      .prepare(
        `SELECT type, reason, blocker_code, host_pid
         FROM message_reactions
         WHERE thread_id = ? AND message_id = ? AND participant_id = ?`
      )
      .get(threadId, messageId, participantId) as
      | { type: ReactionType; reason: string | null; blocker_code: string | null; host_pid: number | null }
      | undefined;

    if (!isAllowedTransition(existing?.type ?? null, type)) {
      throw new ReactionStoreError(
        `Cannot transition reaction from "${existing!.type}" to "${type}"`,
        409
      );
    }

    const unchanged =
      existing &&
      existing.type === type &&
      normalizeOptionalText(existing.reason) === reason &&
      normalizeOptionalText(existing.blocker_code) === blockerCode &&
      normalizeOptionalHostPid(existing.host_pid) === hostPid;

    if (unchanged) {
      return {
        updated: false,
        reactions: loadMessageReactions(db, threadId, [messageId]).get(messageId) ?? [],
      };
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO message_reactions (thread_id, message_id, participant_id, type, reason, blocker_code, host_pid, response_message_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, message_id, participant_id)
       DO UPDATE SET
         type = excluded.type,
         reason = excluded.reason,
         blocker_code = excluded.blocker_code,
         host_pid = excluded.host_pid,
         response_message_id = COALESCE(excluded.response_message_id, message_reactions.response_message_id),
         updated_at = excluded.updated_at`
    ).run(threadId, messageId, participantId, type, reason, blockerCode, hostPid, responseMessageId, now);

    return {
      updated: true,
      reactions: loadMessageReactions(db, threadId, [messageId]).get(messageId) ?? [],
    };
  });
}

// --- Thread Info ---

export async function getThreadInfos(threadId: string): Promise<ThreadInfo[]> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  return withDatabase((db) => {
    const rows = db
      .prepare(
        `SELECT root_message_id, COUNT(*) as reply_count, MAX(timestamp) as last_activity
         FROM messages
         WHERE thread_id = ? AND root_message_id IS NOT NULL
         GROUP BY root_message_id
         ORDER BY last_activity DESC`
      )
      .all(normalizedThreadId) as Array<{
      root_message_id: string;
      reply_count: number;
      last_activity: number;
    }>;

    return rows.map((r) => {
      const participants = db
        .prepare(
          `SELECT DISTINCT participant_id FROM messages
           WHERE thread_id = ? AND root_message_id = ? AND participant_id IS NOT NULL`
        )
        .all(normalizedThreadId, r.root_message_id) as Array<{ participant_id: string }>;

      return {
        rootMessageId: r.root_message_id,
        replyCount: r.reply_count,
        participants: participants.map((p) => p.participant_id),
        lastActivityAt: r.last_activity,
      };
    });
  });
}

// --- Logs ---

export interface LogRow {
  id: number;
  agent_process_id: number;
  participant_id: string;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

export async function saveLogs(
  agentProcessId: number,
  entries: Array<{ stream: "stdout" | "stderr"; line: string; timestamp: number }>
): Promise<void> {
  if (entries.length === 0 || !agentProcessId) return;
  return withDatabase((db) => {
    const stmt = db.prepare(
      "INSERT INTO logs (agent_process_id, stream, line, timestamp) VALUES (?, ?, ?, ?)"
    );
    transaction(db, () => {
      for (const e of entries) {
        stmt.run(agentProcessId, e.stream, e.line, e.timestamp);
      }
    });
  });
}

export async function loadLogs(workspaceId: string): Promise<LogRow[]> {
  const normalized = workspaceId.trim();
  if (!normalized) return [];
  return withDatabase((db) => {
    const rows = db
      .prepare(
        `SELECT l.id, l.agent_process_id, ap.agent_id as participant_id, l.stream, l.line, l.timestamp
         FROM logs l
         JOIN agent_processes ap ON ap.id = l.agent_process_id
         WHERE ap.workspace_id = ?
         ORDER BY l.timestamp DESC, l.id DESC
         LIMIT 100`
      )
      .all(normalized) as unknown as LogRow[];
    return rows.reverse();
  });
}

export interface ProcessLogEntry {
  processId: number;
  agent: string;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

export async function loadLogsByProcessPids(
  pids: number[]
): Promise<ProcessLogEntry[]> {
  if (pids.length === 0) return [];
  return withDatabase((db) => {
    const placeholders = pids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT ap.pid as process_pid, ap.agent_id as agent, l.stream, l.line, l.timestamp
         FROM logs l
         JOIN agent_processes ap ON ap.id = l.agent_process_id
         WHERE ap.pid IN (${placeholders})
         ORDER BY l.timestamp ASC, l.id ASC
         LIMIT 200`
      )
      .all(...pids) as Array<{
      process_pid: number;
      agent: string;
      stream: "stdout" | "stderr";
      line: string;
      timestamp: number;
    }>;
    return rows.map((r) => ({
      processId: r.process_pid,
      agent: r.agent,
      stream: r.stream,
      line: r.line,
      timestamp: r.timestamp,
    }));
  });
}

export async function clearLogs(workspaceId: string): Promise<void> {
  const normalized = workspaceId.trim();
  if (!normalized) return;
  return withDatabase((db) => {
    db.prepare(
      `DELETE FROM logs WHERE agent_process_id IN (
         SELECT id FROM agent_processes WHERE workspace_id = ?
       )`
    ).run(normalized);
  });
}

export async function sweepStaleWorkingReactions(
  threadId: string,
  olderThanMs: number = 5 * 60 * 1000
): Promise<SweepStaleWorkingResult> {
  const normalizedThreadId = threadId.trim() || LEGACY_THREAD_ID;
  const thresholdMs = Number.isFinite(olderThanMs) ? Math.max(olderThanMs, 1) : 5 * 60 * 1000;
  const now = Date.now();
  const cutoff = now - thresholdMs;

  return withDatabase((db) => {
    const result = db
      .prepare(
        `UPDATE message_reactions
         SET type = 'blocked',
             reason = 'stale_timeout',
             blocker_code = 'stale_timeout',
             updated_at = ?
         WHERE thread_id = ? AND type = 'working' AND updated_at <= ?`
      )
      .run(now, normalizedThreadId, cutoff);

    return { updated: Number(result.changes) };
  });
}

// ── Thread repo selections ──────────────────────────────────────────────────

export async function loadThreadRepoSelections(
  rootMessageId: string,
): Promise<string[]> {
  const key = rootMessageId.trim() || LEGACY_THREAD_ID;
  return withDatabase((db) => {
    const rows = db
      .prepare("SELECT repo_id FROM thread_repo_selections WHERE thread_id = ?")
      .all(key) as Array<{ repo_id: string }>;
    return rows.map((r) => r.repo_id);
  });
}

export async function saveThreadRepoSelections(
  rootMessageId: string,
  repoIds: string[],
): Promise<void> {
  const key = rootMessageId.trim() || LEGACY_THREAD_ID;
  return withDatabase((db) => {
    db.prepare("DELETE FROM thread_repo_selections WHERE thread_id = ?")
      .run(key);
    if (repoIds.length > 0) {
      const insert = db.prepare(
        "INSERT INTO thread_repo_selections (thread_id, repo_id) VALUES (?, ?)"
      );
      for (const repoId of repoIds) {
        insert.run(key, repoId);
      }
    }
  });
}

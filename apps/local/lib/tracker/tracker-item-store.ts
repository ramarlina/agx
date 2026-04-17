import "server-only";

// Tracker-agnostic SQLite cache for issues/items from any connected tracker.
// Migrates the old `linear_issues` table to `tracker_items` on first use.

import type { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TrackerStatusCategory } from "./types";
import { pragmaSet } from "../sqlite-compat";

const TRACKER_DIR =
  process.env.AGX_TRACKER_DIR?.trim() ||
  path.join(process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"), "tracker");
const DB_PATH = path.join(TRACKER_DIR, "items.sqlite");

// --- Row types for the new tracker_items table ---

interface TrackerItemRow {
  issue_id: string;
  tracker_type: string;
  tracker_id: string;
  identifier: string;
  title: string;
  description: string | null;
  labels_json: string | null;
  url: string | null;
  status: string;
  status_category: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  is_assigned_to_me: number;
  team_id: string | null;
  team_name: string | null;
  team_key: string | null;
  cycle_id: string | null;
  cycle_name: string | null;
  cycle_number: number | null;
  priority: string | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string;
  pulled_at: number;
}

interface TrackerItemSyncStateRow {
  scope_key: string;
  last_pulled_at: number;
  issue_count: number;
}

// --- Public types ---

export interface CachedTrackerItemRecord {
  id: string;
  trackerType: string;
  trackerId: string;
  identifier: string;
  title: string;
  description: string | null;
  labels?: string[];
  url: string | null;
  status: string;
  statusCategory: TrackerStatusCategory;
  assigneeId: string | null;
  assignee: string | null;
  assigneeEmail: string | null;
  isAssignedToMe: boolean;
  teamId: string | null;
  teamName: string | null;
  teamKey: string | null;
  cycleId: string | null;
  cycleName: string | null;
  cycleNumber: number | null;
  priority: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string;
  pulledAt: string;
}

export interface CachedTrackerItemInput {
  id: string;
  trackerType: string;
  trackerId: string;
  identifier: string;
  title: string;
  description?: string | null;
  labels?: string[];
  url?: string | null;
  status: string;
  statusCategory?: TrackerStatusCategory;
  assigneeId?: string | null;
  assignee?: string | null;
  assigneeEmail?: string | null;
  isAssignedToMe?: boolean;
  teamId?: string | null;
  teamName?: string | null;
  teamKey?: string | null;
  cycleId?: string | null;
  cycleName?: string | null;
  cycleNumber?: number | null;
  priority?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt: string;
}

export interface TrackerItemSyncState {
  scopeKey: string;
  lastPulledAt: string;
  issueCount: number;
}

export type TrackerItemSortField = "activity" | "identifier" | "status" | "created";
export type TrackerItemSortDir = "asc" | "desc";

export interface ListCachedTrackerItemsInput {
  trackerType?: string;
  search?: string;
  statuses?: string[];
  statusCategories?: TrackerStatusCategory[];
  assigneeIds?: string[];
  assignedToMe?: boolean;
  teamId?: string;
  cycleId?: string;
  groupIds?: string[];
  limit?: number;
  cursor?: string | null;
  sortBy?: TrackerItemSortField;
  sortDir?: TrackerItemSortDir;
  hasActivity?: boolean;
  activityMap?: Map<string, string>;
}

export interface ListCachedTrackerItemsResult {
  issues: CachedTrackerItemRecord[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

// --- Helpers ---

function toOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry: unknown) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

function serializeLabels(value: string[] | undefined): string {
  return JSON.stringify(normalizeLabels(value ?? []));
}

function parseLabels(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeLabels(JSON.parse(value));
  } catch {
    return [];
  }
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function inferStatusCategory(status: string): TrackerStatusCategory {
  const lower = status.trim().toLowerCase();
  if (["done", "completed", "closed"].includes(lower)) return "done";
  if (["cancelled", "canceled", "duplicate"].includes(lower)) return "cancelled";
  if (["in progress", "in review", "started", "testing"].includes(lower)) return "in_progress";
  return "todo";
}

function mapRow(row: TrackerItemRow): CachedTrackerItemRecord {
  return {
    id: row.issue_id,
    trackerType: row.tracker_type,
    trackerId: row.tracker_id,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    labels: parseLabels(row.labels_json),
    url: row.url,
    status: row.status,
    statusCategory: (row.status_category as TrackerStatusCategory) || inferStatusCategory(row.status),
    assigneeId: row.assignee_id,
    assignee: row.assignee_name,
    assigneeEmail: row.assignee_email,
    isAssignedToMe: row.is_assigned_to_me === 1,
    teamId: row.team_id,
    teamName: row.team_name,
    teamKey: row.team_key,
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    cycleNumber: row.cycle_number,
    priority: row.priority,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pulledAt: toIso(row.pulled_at),
  };
}

function mapSyncState(row: TrackerItemSyncStateRow): TrackerItemSyncState {
  return {
    scopeKey: row.scope_key,
    lastPulledAt: toIso(row.last_pulled_at),
    issueCount: row.issue_count,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// --- Migration ---

function migrateFromLinearIssues(db: DatabaseSync): void {
  // Check if old table exists
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='linear_issues'")
    .get() as { name: string } | undefined;

  if (!tables) return;

  // Read old data
  const oldRows = db.prepare("SELECT * FROM linear_issues").all() as unknown as Record<string, unknown>[];

  if (oldRows.length > 0) {
    // Insert into tracker_items
    const insert = db.prepare(`
      INSERT INTO tracker_items (
        issue_id, tracker_type, tracker_id, identifier, title, description,
        labels_json, url, status, status_category,
        assignee_id, assignee_name, assignee_email, is_assigned_to_me,
        team_id, team_name, team_key, cycle_id, cycle_name, cycle_number,
        priority, metadata_json, updated_at, pulled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        tracker_type = excluded.tracker_type,
        tracker_id = excluded.tracker_id,
        identifier = excluded.identifier,
        title = excluded.title,
        status = excluded.status
    `);

    for (const row of oldRows) {
      const r = row as Record<string, unknown>;
      const status = String(r.status ?? "Unknown");
      insert.run(
        String(r.issue_id),
        "linear",
        `linear:${r.team_id ?? "default"}`,
        String(r.identifier),
        String(r.title),
        toOptionalString(String(r.description ?? "")),
        String(r.labels_json ?? "[]"),
        toOptionalString(String(r.url ?? "")),
        status,
        inferStatusCategory(status),
        toOptionalString(String(r.assignee_id ?? "")),
        toOptionalString(String(r.assignee_name ?? "")),
        toOptionalString(String(r.assignee_email ?? "")),
        Number(r.is_assigned_to_me ?? 0) ? 1 : 0,
        toOptionalString(String(r.team_id ?? "")),
        toOptionalString(String(r.team_name ?? "")),
        toOptionalString(String(r.team_key ?? "")),
        toOptionalString(String(r.cycle_id ?? "")),
        toOptionalString(String(r.cycle_name ?? "")),
        toOptionalNumber(Number(r.cycle_number ?? null)),
        null, // priority
        "{}", // metadata_json
        String(r.updated_at),
        Number(r.pulled_at)
      );
    }
  }

  // Drop old table
  db.exec("DROP TABLE IF EXISTS linear_issues");

  // Migrate sync state table too
  const syncTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='linear_issue_sync_state'")
    .get() as { name: string } | undefined;

  if (syncTables) {
    const oldSyncRows = db.prepare("SELECT * FROM linear_issue_sync_state").all() as unknown as Record<string, unknown>[];
    for (const row of oldSyncRows) {
      db.prepare(
        `INSERT INTO tracker_item_sync_state (scope_key, last_pulled_at, issue_count)
         VALUES (?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           last_pulled_at = excluded.last_pulled_at,
           issue_count = excluded.issue_count`
      ).run(String(row.scope_key), Number(row.last_pulled_at), Number(row.issue_count));
    }
    db.exec("DROP TABLE IF EXISTS linear_issue_sync_state");
  }
}

// --- Database access ---

function ensureColumn(db: DatabaseSync, table: string, column: string, sql: string): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
  }
}

async function withTrackerItemDatabase<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(TRACKER_DIR, { recursive: true });
  const db = new (process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite")).DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tracker_items (
        issue_id TEXT PRIMARY KEY,
        tracker_type TEXT NOT NULL DEFAULT 'linear',
        tracker_id TEXT NOT NULL DEFAULT '',
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        status TEXT NOT NULL,
        status_category TEXT NOT NULL DEFAULT 'todo',
        assignee_id TEXT,
        assignee_name TEXT,
        assignee_email TEXT,
        is_assigned_to_me INTEGER NOT NULL DEFAULT 0,
        team_id TEXT,
        team_name TEXT,
        team_key TEXT,
        cycle_id TEXT,
        cycle_name TEXT,
        cycle_number INTEGER,
        priority TEXT,
        metadata_json TEXT,
        updated_at TEXT NOT NULL,
        pulled_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tracker_items_updated
        ON tracker_items (updated_at DESC, identifier ASC);
      CREATE INDEX IF NOT EXISTS idx_tracker_items_type_id
        ON tracker_items (tracker_type, tracker_id);
      CREATE INDEX IF NOT EXISTS idx_tracker_items_cycle
        ON tracker_items (cycle_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracker_items_assignee_me
        ON tracker_items (is_assigned_to_me, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracker_items_status_category
        ON tracker_items (status_category, updated_at DESC);
      CREATE TABLE IF NOT EXISTS tracker_item_sync_state (
        scope_key TEXT PRIMARY KEY,
        last_pulled_at INTEGER NOT NULL,
        issue_count INTEGER NOT NULL
      );
    `);

    // Run migration from old linear_issues table if it exists
    migrateFromLinearIssues(db);

    // Ensure columns that may have been added later
    ensureColumn(db, "tracker_items", "labels_json", "labels_json TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(db, "tracker_items", "tracker_type", "tracker_type TEXT NOT NULL DEFAULT 'linear'");
    ensureColumn(db, "tracker_items", "tracker_id", "tracker_id TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "tracker_items", "status_category", "status_category TEXT NOT NULL DEFAULT 'todo'");
    ensureColumn(db, "tracker_items", "priority", "priority TEXT");
    ensureColumn(db, "tracker_items", "metadata_json", "metadata_json TEXT");
    ensureColumn(db, "tracker_items", "created_at", "created_at TEXT");

    return run(db);
  } finally {
    db.close();
  }
}

// --- Public API ---

export async function replaceCachedTrackerItems(input: {
  trackerType: string;
  issues: CachedTrackerItemInput[];
  complete?: boolean;
  pulledAtMs?: number;
}): Promise<void> {
  const pulledAtMs = input.pulledAtMs ?? Date.now();
  const trackerType = input.trackerType;

  return withTrackerItemDatabase((db) => {
    db.exec("BEGIN");
    try {
      const upsert = db.prepare(`
        INSERT INTO tracker_items (
          issue_id, tracker_type, tracker_id, identifier, title, description,
          labels_json, url, status, status_category,
          assignee_id, assignee_name, assignee_email, is_assigned_to_me,
          team_id, team_name, team_key, cycle_id, cycle_name, cycle_number,
          priority, metadata_json, created_at, updated_at, pulled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(issue_id) DO UPDATE SET
          tracker_type = excluded.tracker_type,
          tracker_id = excluded.tracker_id,
          identifier = excluded.identifier,
          title = excluded.title,
          description = excluded.description,
          labels_json = excluded.labels_json,
          url = excluded.url,
          status = excluded.status,
          status_category = excluded.status_category,
          assignee_id = excluded.assignee_id,
          assignee_name = excluded.assignee_name,
          assignee_email = excluded.assignee_email,
          is_assigned_to_me = excluded.is_assigned_to_me,
          team_id = excluded.team_id,
          team_name = excluded.team_name,
          team_key = excluded.team_key,
          cycle_id = excluded.cycle_id,
          cycle_name = excluded.cycle_name,
          cycle_number = excluded.cycle_number,
          priority = excluded.priority,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          pulled_at = excluded.pulled_at
      `);

      for (const issue of input.issues) {
        const statusCategory = issue.statusCategory ?? inferStatusCategory(issue.status);
        upsert.run(
          issue.id.trim(),
          (issue.trackerType ?? trackerType).trim(),
          (issue.trackerId ?? "").trim(),
          issue.identifier.trim(),
          issue.title.trim(),
          toOptionalString(issue.description ?? null),
          serializeLabels(issue.labels),
          toOptionalString(issue.url ?? null),
          issue.status.trim(),
          statusCategory,
          toOptionalString(issue.assigneeId ?? null),
          toOptionalString(issue.assignee ?? null),
          toOptionalString(issue.assigneeEmail ?? null),
          issue.isAssignedToMe ? 1 : 0,
          toOptionalString(issue.teamId ?? null),
          toOptionalString(issue.teamName ?? null),
          toOptionalString(issue.teamKey ?? null),
          toOptionalString(issue.cycleId ?? null),
          toOptionalString(issue.cycleName ?? null),
          toOptionalNumber(issue.cycleNumber ?? null),
          toOptionalString(issue.priority ?? null),
          issue.metadata ? JSON.stringify(issue.metadata) : null,
          toOptionalString(issue.createdAt ?? null),
          issue.updatedAt.trim(),
          pulledAtMs
        );
      }

      if (input.complete !== false) {
        if (input.issues.length === 0) {
          db.prepare(`DELETE FROM tracker_items WHERE tracker_type = ?`).run(trackerType);
        } else {
          const placeholders = input.issues.map(() => "?").join(", ");
          db.prepare(
            `DELETE FROM tracker_items WHERE tracker_type = ? AND issue_id NOT IN (${placeholders})`
          ).run(
            trackerType,
            ...input.issues.map((issue) => issue.id.trim())
          );
        }
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function setTrackerItemSyncState(
  scopeKey: string,
  issueCount: number,
  pulledAtMs = Date.now()
): Promise<void> {
  const normalizedScopeKey = scopeKey.trim() || "global";

  return withTrackerItemDatabase((db) => {
    db.prepare(`
      INSERT INTO tracker_item_sync_state (scope_key, last_pulled_at, issue_count)
      VALUES (?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        last_pulled_at = excluded.last_pulled_at,
        issue_count = excluded.issue_count
    `).run(normalizedScopeKey, pulledAtMs, issueCount);
  });
}

export async function getTrackerItemSyncState(scopeKey = "global"): Promise<TrackerItemSyncState | null> {
  const normalizedScopeKey = scopeKey.trim() || "global";

  return withTrackerItemDatabase((db) => {
    const row = db
      .prepare(
        `SELECT scope_key, last_pulled_at, issue_count
         FROM tracker_item_sync_state
         WHERE scope_key = ?
         LIMIT 1`
      )
      .get(normalizedScopeKey) as TrackerItemSyncStateRow | undefined;

    return row ? mapSyncState(row) : null;
  });
}

export async function countCachedTrackerItems(trackerType?: string): Promise<number> {
  return withTrackerItemDatabase((db) => {
    if (trackerType) {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM tracker_items WHERE tracker_type = ?")
        .get(trackerType) as { count: number } | undefined;
      return row?.count ?? 0;
    }
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM tracker_items")
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  });
}

export async function listCachedTrackerItems(
  input: ListCachedTrackerItemsInput = {}
): Promise<ListCachedTrackerItemsResult> {
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(Number(input.limit), 1), 500)
    : 50;
  const offset = Number.isFinite(Number(input.cursor))
    ? Math.max(Number(input.cursor), 0)
    : 0;

  return withTrackerItemDatabase((db) => {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    // Filter by tracker type if specified
    if (input.trackerType) {
      clauses.push("tracker_type = ?");
      params.push(input.trackerType);
    }

    const search = toOptionalString(input.search ?? null);
    if (search) {
      const pattern = `%${escapeLike(search.toLowerCase())}%`;
      clauses.push(
        `(LOWER(identifier) LIKE ? ESCAPE '\\' OR LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(description, '')) LIKE ? ESCAPE '\\')`
      );
      params.push(pattern, pattern, pattern);
    }

    const statuses = Array.from(
      new Set(
        (input.statuses ?? [])
          .map((status) => toOptionalString(status))
          .filter((status): status is string => Boolean(status))
          .map((status) => status.toLowerCase())
      )
    );
    if (statuses.length > 0) {
      clauses.push(`LOWER(status) IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }

    const statusCategories = input.statusCategories;
    if (statusCategories && statusCategories.length > 0) {
      clauses.push(
        `status_category IN (${statusCategories.map(() => "?").join(", ")})`
      );
      params.push(...statusCategories);
    }

    const assigneeIds = Array.from(
      new Set(
        (input.assigneeIds ?? [])
          .map((assigneeId) => toOptionalString(assigneeId))
          .filter((assigneeId): assigneeId is string => Boolean(assigneeId))
      )
    );
    if (assigneeIds.length > 0) {
      clauses.push(`assignee_id IN (${assigneeIds.map(() => "?").join(", ")})`);
      params.push(...assigneeIds);
    }

    if (input.assignedToMe) {
      clauses.push("is_assigned_to_me = 1");
    }

    const teamId = toOptionalString(input.teamId ?? null);
    if (teamId) {
      clauses.push("team_id = ?");
      params.push(teamId);
    }

    const groupIds = Array.from(
      new Set(
        [
          ...((input.groupIds ?? [])
            .map((groupId) => toOptionalString(groupId))
            .filter((groupId): groupId is string => Boolean(groupId))),
          ...((input.cycleId ? [input.cycleId] : [])
            .map((cycleId) => toOptionalString(cycleId))
            .filter((cycleId): cycleId is string => Boolean(cycleId))),
        ]
      )
    );
    if (groupIds.length > 0) {
      clauses.push(`cycle_id IN (${groupIds.map(() => "?").join(", ")})`);
      params.push(...groupIds);
    }

    // Activity-based filtering
    if (input.hasActivity && input.activityMap) {
      const activeIds = Array.from(input.activityMap.keys());
      if (activeIds.length === 0) {
        return { issues: [], pageInfo: { hasNextPage: false, endCursor: null } };
      }
      clauses.push(`issue_id IN (${activeIds.map(() => "?").join(", ")})`);
      params.push(...activeIds);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const sortBy = input.sortBy ?? "activity";
    const sortDir = input.sortDir ?? "desc";
    const dirSql = sortDir === "asc" ? "ASC" : "DESC";

    if (sortBy === "activity" && input.activityMap && input.activityMap.size > 0) {
      const activeIds = Array.from(input.activityMap.keys());
      const activeIdsPlaceholders = activeIds.map(() => "?").join(", ");

      const activeWhereClause = whereClause
        ? `${whereClause} AND issue_id IN (${activeIdsPlaceholders})`
        : `WHERE issue_id IN (${activeIdsPlaceholders})`;

      const activeRows = db
        .prepare(
          `SELECT * FROM tracker_items ${activeWhereClause} ORDER BY updated_at DESC, identifier ASC`
        )
        .all(...params, ...activeIds) as unknown as TrackerItemRow[];

      const activityMap = input.activityMap;
      activeRows.sort((a, b) => {
        const aTime = activityMap.get(a.issue_id) ?? "";
        const bTime = activityMap.get(b.issue_id) ?? "";
        return sortDir === "desc"
          ? bTime.localeCompare(aTime)
          : aTime.localeCompare(bTime);
      });

      let inactiveRows: TrackerItemRow[] = [];
      if (!input.hasActivity) {
        const inactiveWhereClause = whereClause
          ? `${whereClause} AND issue_id NOT IN (${activeIdsPlaceholders})`
          : `WHERE issue_id NOT IN (${activeIdsPlaceholders})`;

        inactiveRows = db
          .prepare(
            `SELECT * FROM tracker_items ${inactiveWhereClause} ORDER BY updated_at DESC, identifier ASC`
          )
          .all(...params, ...activeIds) as unknown as TrackerItemRow[];
      }

      const allRows = [...activeRows, ...inactiveRows];
      const pageRows = allRows.slice(offset, offset + limit + 1);
      const hasNextPage = pageRows.length > limit;
      const finalRows = hasNextPage ? pageRows.slice(0, limit) : pageRows;
      const endCursor = hasNextPage ? String(offset + limit) : null;

      return {
        issues: finalRows.map(mapRow),
        pageInfo: { hasNextPage, endCursor },
      };
    }

    // Non-activity sort fields
    let orderClause: string;
    switch (sortBy) {
      case "identifier":
        orderClause = `ORDER BY identifier ${dirSql}`;
        break;
      case "status":
        orderClause = `ORDER BY LOWER(status) ${dirSql}, identifier ASC`;
        break;
      case "created":
        orderClause = `ORDER BY COALESCE(created_at, updated_at) ${dirSql}, identifier ASC`;
        break;
      default:
        orderClause = `ORDER BY updated_at ${dirSql}, identifier ASC`;
        break;
    }

    const rows = db
      .prepare(
        `SELECT *
         FROM tracker_items
         ${whereClause}
         ${orderClause}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit + 1, offset) as unknown as TrackerItemRow[];

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const endCursor = hasNextPage ? String(offset + limit) : null;

    return {
      issues: pageRows.map(mapRow),
      pageInfo: { hasNextPage, endCursor },
    };
  });
}

export async function listCachedTrackerItemStatuses(trackerType?: string): Promise<string[]> {
  return withTrackerItemDatabase((db) => {
    const sql = trackerType
      ? `SELECT DISTINCT status FROM tracker_items WHERE TRIM(status) <> '' AND tracker_type = ? ORDER BY LOWER(status) ASC`
      : `SELECT DISTINCT status FROM tracker_items WHERE TRIM(status) <> '' ORDER BY LOWER(status) ASC`;
    const rows = trackerType
      ? (db.prepare(sql).all(trackerType) as unknown as { status: string }[])
      : (db.prepare(sql).all() as unknown as { status: string }[]);

    return rows
      .map((row) => row.status.trim())
      .filter(Boolean);
  });
}

export async function updateCachedTrackerItemStatus(input: {
  issueId: string;
  status: string;
  updatedAt: string;
  pulledAtMs?: number;
}): Promise<void> {
  const issueId = input.issueId.trim();
  const status = input.status.trim();
  const updatedAt = input.updatedAt.trim();
  if (!issueId || !status || !updatedAt) return;

  const pulledAtMs = input.pulledAtMs ?? Date.now();

  return withTrackerItemDatabase((db) => {
    db.prepare(
      `UPDATE tracker_items
       SET status = ?, status_category = ?, updated_at = ?, pulled_at = ?
       WHERE issue_id = ?`
    ).run(status, inferStatusCategory(status), updatedAt, pulledAtMs, issueId);
  });
}

export async function getCachedTrackerItemContexts(issueIds: string[]): Promise<CachedTrackerItemRecord[]> {
  const normalizedIds = Array.from(
    new Set(
      issueIds
        .map((issueId) => issueId.trim())
        .filter(Boolean)
    )
  );

  if (normalizedIds.length === 0) return [];

  return withTrackerItemDatabase((db) => {
    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT *
         FROM tracker_items
         WHERE issue_id IN (${placeholders})`
      )
      .all(...normalizedIds) as unknown as TrackerItemRow[];

    const byId = new Map(rows.map((row) => [row.issue_id, mapRow(row)]));
    return normalizedIds
      .map((issueId) => byId.get(issueId))
      .filter((issue): issue is CachedTrackerItemRecord => Boolean(issue));
  });
}

// Backward-compatible aliases for the migration period
export const replaceCachedLinearIssues = replaceCachedTrackerItems;
export const setLinearIssueSyncState = setTrackerItemSyncState;
export const getLinearIssueSyncState = getTrackerItemSyncState;
export const countCachedLinearIssues = countCachedTrackerItems;
export const listCachedLinearIssues = listCachedTrackerItems;
export const listCachedLinearIssueStatuses = listCachedTrackerItemStatuses;
export const updateCachedLinearIssueStatus = updateCachedTrackerItemStatus;
export const getCachedLinearIssueContexts = getCachedTrackerItemContexts;
export type CachedLinearIssueRecord = CachedTrackerItemRecord;
export type CachedLinearIssueInput = CachedTrackerItemInput;
export type LinearIssueSyncState = TrackerItemSyncState;
export type LinearIssueSortField = TrackerItemSortField;
export type LinearIssueSortDir = TrackerItemSortDir;
export type ListCachedLinearIssuesInput = ListCachedTrackerItemsInput;
export type ListCachedLinearIssuesResult = ListCachedTrackerItemsResult;

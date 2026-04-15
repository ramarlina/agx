import "server-only";

import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pragmaSet } from "./sqlite-compat";

const LINEAR_DIR =
  process.env.AGX_LINEAR_DIR?.trim() ||
  path.join(process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"), "linear");
const DB_PATH = path.join(LINEAR_DIR, "issues.sqlite");

interface LinearIssueRow {
  issue_id: string;
  identifier: string;
  title: string;
  description: string | null;
  labels_json: string | null;
  url: string | null;
  status: string;
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
  updated_at: string;
  pulled_at: number;
}

interface LinearIssueSyncStateRow {
  scope_key: string;
  last_pulled_at: number;
  issue_count: number;
}

export interface CachedLinearIssueRecord {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  labels?: string[];
  url: string | null;
  status: string;
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
  updatedAt: string;
  pulledAt: string;
}

export interface CachedLinearIssueInput {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  labels?: string[];
  url?: string | null;
  status: string;
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
  updatedAt: string;
}

export interface LinearIssueSyncState {
  scopeKey: string;
  lastPulledAt: string;
  issueCount: number;
}

export type LinearIssueSortField = "activity" | "identifier" | "status" | "created";
export type LinearIssueSortDir = "asc" | "desc";

export interface ListCachedLinearIssuesInput {
  search?: string;
  statuses?: string[];
  assigneeIds?: string[];
  assignedToMe?: boolean;
  teamId?: string;
  cycleId?: string;
  limit?: number;
  cursor?: string | null;
  sortBy?: LinearIssueSortField;
  sortDir?: LinearIssueSortDir;
  hasActivity?: boolean;
  /** Map of issue_id -> ISO timestamp from runs DB, required when sortBy=activity or hasActivity=true */
  activityMap?: Map<string, string>;
}

export interface ListCachedLinearIssuesResult {
  issues: CachedLinearIssueRecord[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface LinearIssueStatusRow {
  status: string;
}

function toOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

function serializeLabels(value: string[] | undefined): string {
  return JSON.stringify(normalizeLabels(value ?? []));
}

function parseLabels(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    return normalizeLabels(JSON.parse(value));
  } catch {
    return [];
  }
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function mapRow(row: LinearIssueRow): CachedLinearIssueRecord {
  return {
    id: row.issue_id,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    labels: parseLabels(row.labels_json),
    url: row.url,
    status: row.status,
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
    updatedAt: row.updated_at,
    pulledAt: toIso(row.pulled_at),
  };
}

function mapSyncState(row: LinearIssueSyncStateRow): LinearIssueSyncState {
  return {
    scopeKey: row.scope_key,
    lastPulledAt: toIso(row.last_pulled_at),
    issueCount: row.issue_count,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function ensureColumn(db: DatabaseSync, table: string, column: string, sql: string): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
  }
}

async function withLinearIssueDatabase<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(LINEAR_DIR, { recursive: true });
  const db = new DatabaseSyncCtor(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS linear_issues (
        issue_id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        status TEXT NOT NULL,
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
        updated_at TEXT NOT NULL,
        pulled_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_linear_issues_updated
        ON linear_issues (updated_at DESC, identifier ASC);
      CREATE INDEX IF NOT EXISTS idx_linear_issues_cycle
        ON linear_issues (cycle_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_linear_issues_assignee_me
        ON linear_issues (is_assigned_to_me, updated_at DESC);
      CREATE TABLE IF NOT EXISTS linear_issue_sync_state (
        scope_key TEXT PRIMARY KEY,
        last_pulled_at INTEGER NOT NULL,
        issue_count INTEGER NOT NULL
      );
    `);
    ensureColumn(db, "linear_issues", "labels_json", "labels_json TEXT NOT NULL DEFAULT '[]'");
    return run(db);
  } finally {
    db.close();
  }
}

export async function replaceCachedLinearIssues(input: {
  issues: CachedLinearIssueInput[];
  complete: boolean;
  pulledAtMs?: number;
}): Promise<void> {
  const pulledAtMs = input.pulledAtMs ?? Date.now();

  return withLinearIssueDatabase((db) => {
    db.exec("BEGIN");

    try {
      const upsert = db.prepare(`
        INSERT INTO linear_issues (
          issue_id, identifier, title, description, labels_json, url, status,
          assignee_id, assignee_name, assignee_email, is_assigned_to_me,
          team_id, team_name, team_key, cycle_id, cycle_name, cycle_number,
          updated_at, pulled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(issue_id) DO UPDATE SET
          identifier = excluded.identifier,
          title = excluded.title,
          description = excluded.description,
          labels_json = excluded.labels_json,
          url = excluded.url,
          status = excluded.status,
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
          updated_at = excluded.updated_at,
          pulled_at = excluded.pulled_at
      `);

      for (const issue of input.issues) {
        upsert.run(
          issue.id.trim(),
          issue.identifier.trim(),
          issue.title.trim(),
          toOptionalString(issue.description ?? null),
          serializeLabels(issue.labels),
          toOptionalString(issue.url ?? null),
          issue.status.trim(),
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
          issue.updatedAt.trim(),
          pulledAtMs
        );
      }

      if (input.complete) {
        if (input.issues.length === 0) {
          db.exec("DELETE FROM linear_issues");
        } else {
          const placeholders = input.issues.map(() => "?").join(", ");
          db.prepare(`DELETE FROM linear_issues WHERE issue_id NOT IN (${placeholders})`).run(
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

export async function setLinearIssueSyncState(
  scopeKey: string,
  issueCount: number,
  pulledAtMs = Date.now()
): Promise<void> {
  const normalizedScopeKey = scopeKey.trim() || "global";

  return withLinearIssueDatabase((db) => {
    db.prepare(`
      INSERT INTO linear_issue_sync_state (scope_key, last_pulled_at, issue_count)
      VALUES (?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        last_pulled_at = excluded.last_pulled_at,
        issue_count = excluded.issue_count
    `).run(normalizedScopeKey, pulledAtMs, issueCount);
  });
}

export async function getLinearIssueSyncState(scopeKey = "global"): Promise<LinearIssueSyncState | null> {
  const normalizedScopeKey = scopeKey.trim() || "global";

  return withLinearIssueDatabase((db) => {
    const row = db
      .prepare(
        `SELECT scope_key, last_pulled_at, issue_count
         FROM linear_issue_sync_state
         WHERE scope_key = ?
         LIMIT 1`
      )
      .get(normalizedScopeKey) as LinearIssueSyncStateRow | undefined;

    return row ? mapSyncState(row) : null;
  });
}

export async function countCachedLinearIssues(): Promise<number> {
  return withLinearIssueDatabase((db) => {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM linear_issues")
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  });
}

export async function listCachedLinearIssues(
  input: ListCachedLinearIssuesInput = {}
): Promise<ListCachedLinearIssuesResult> {
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(Number(input.limit), 1), 500)
    : 50;
  const offset = Number.isFinite(Number(input.cursor))
    ? Math.max(Number(input.cursor), 0)
    : 0;

  return withLinearIssueDatabase((db) => {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

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

    const cycleId = toOptionalString(input.cycleId ?? null);
    if (cycleId) {
      clauses.push("cycle_id = ?");
      params.push(cycleId);
    }

    // Activity-based filtering
    if (input.hasActivity && input.activityMap) {
      const activeIds = Array.from(input.activityMap.keys());
      if (activeIds.length === 0) {
        return {
          issues: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      }
      clauses.push(`issue_id IN (${activeIds.map(() => "?").join(", ")})`);
      params.push(...activeIds);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const sortBy = input.sortBy ?? "activity";
    const sortDir = input.sortDir ?? "desc";
    const dirSql = sortDir === "asc" ? "ASC" : "DESC";

    if (sortBy === "activity" && input.activityMap && input.activityMap.size > 0) {
      // Two-phase: issues with activity first, then the rest
      const activeIds = Array.from(input.activityMap.keys());
      const activeIdsPlaceholders = activeIds.map(() => "?").join(", ");

      // Phase 1: issues with activity
      const activeWhereClause = whereClause
        ? `${whereClause} AND issue_id IN (${activeIdsPlaceholders})`
        : `WHERE issue_id IN (${activeIdsPlaceholders})`;

      const activeRows = db
        .prepare(
          `SELECT * FROM linear_issues ${activeWhereClause} ORDER BY updated_at DESC, identifier ASC`
        )
        .all(...params, ...activeIds) as unknown as LinearIssueRow[];

      // Sort by activity timestamp in JS (since it's from a different DB)
      const activityMap = input.activityMap;
      activeRows.sort((a, b) => {
        const aTime = activityMap.get(a.issue_id) ?? "";
        const bTime = activityMap.get(b.issue_id) ?? "";
        return sortDir === "desc"
          ? bTime.localeCompare(aTime)
          : aTime.localeCompare(bTime);
      });

      // Phase 2: issues without activity (skip if hasActivity filter is on)
      let inactiveRows: LinearIssueRow[] = [];
      if (!input.hasActivity) {
        const inactiveWhereClause = whereClause
          ? `${whereClause} AND issue_id NOT IN (${activeIdsPlaceholders})`
          : `WHERE issue_id NOT IN (${activeIdsPlaceholders})`;

        inactiveRows = db
          .prepare(
            `SELECT * FROM linear_issues ${inactiveWhereClause} ORDER BY updated_at DESC, identifier ASC`
          )
          .all(...params, ...activeIds) as unknown as LinearIssueRow[];
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
        orderClause = `ORDER BY pulled_at ${dirSql}, identifier ASC`;
        break;
      default:
        orderClause = `ORDER BY updated_at ${dirSql}, identifier ASC`;
        break;
    }

    const rows = db
      .prepare(
        `SELECT *
         FROM linear_issues
         ${whereClause}
         ${orderClause}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit + 1, offset) as unknown as LinearIssueRow[];

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const endCursor = hasNextPage ? String(offset + limit) : null;

    return {
      issues: pageRows.map(mapRow),
      pageInfo: { hasNextPage, endCursor },
    };
  });
}

export async function listCachedLinearIssueStatuses(): Promise<string[]> {
  return withLinearIssueDatabase((db) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT status
         FROM linear_issues
         WHERE TRIM(status) <> ''
         ORDER BY LOWER(status) ASC`
      )
      .all() as unknown as LinearIssueStatusRow[];

    return rows
      .map((row) => row.status.trim())
      .filter(Boolean);
  });
}

export async function updateCachedLinearIssueStatus(input: {
  issueId: string;
  status: string;
  updatedAt: string;
  pulledAtMs?: number;
}): Promise<void> {
  const issueId = input.issueId.trim();
  const status = input.status.trim();
  const updatedAt = input.updatedAt.trim();

  if (!issueId || !status || !updatedAt) {
    return;
  }

  const pulledAtMs = input.pulledAtMs ?? Date.now();

  return withLinearIssueDatabase((db) => {
    db.prepare(
      `UPDATE linear_issues
       SET status = ?, updated_at = ?, pulled_at = ?
       WHERE issue_id = ?`
    ).run(status, updatedAt, pulledAtMs, issueId);
  });
}

export async function getCachedLinearIssueContexts(issueIds: string[]): Promise<CachedLinearIssueRecord[]> {
  const normalizedIds = Array.from(
    new Set(
      issueIds
        .map((issueId) => issueId.trim())
        .filter(Boolean)
    )
  );

  if (normalizedIds.length === 0) {
    return [];
  }

  return withLinearIssueDatabase((db) => {
    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT *
         FROM linear_issues
         WHERE issue_id IN (${placeholders})`
      )
      .all(...normalizedIds) as unknown as LinearIssueRow[];

    const byId = new Map(rows.map((row) => [row.issue_id, mapRow(row)]));
    return normalizedIds
      .map((issueId) => byId.get(issueId))
      .filter((issue): issue is CachedLinearIssueRecord => Boolean(issue));
  });
}

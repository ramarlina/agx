import type { GithubIssue } from "./github-types";
import { withGithubDatabase } from "./github-db";

function parseJsonArray<T>(v: unknown, fallback: T[]): T[] {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function rowToIssue(row: Record<string, unknown>): GithubIssue {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    number: Number(row.number),
    title: String(row.title),
    body: String(row.body),
    state: row.state as GithubIssue["state"],
    authorLogin: String(row.author_login),
    url: String(row.url),
    assignees: parseJsonArray<string>(row.assignees_json, []),
    labels: parseJsonArray<string>(row.labels_json, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    lastSyncedAt: Number(row.last_synced_at),
  };
}

export function upsertGithubIssue(issue: GithubIssue): void {
  withGithubDatabase((db) => {
    db.prepare(
      `INSERT INTO github_issues (id, repo_id, number, title, body, state, author_login, url, assignees_json, labels_json, created_at, updated_at, closed_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         state = excluded.state,
         author_login = excluded.author_login,
         url = excluded.url,
         assignees_json = excluded.assignees_json,
         labels_json = excluded.labels_json,
         updated_at = excluded.updated_at,
         closed_at = excluded.closed_at,
         last_synced_at = excluded.last_synced_at`,
    ).run(
      issue.id,
      issue.repoId,
      issue.number,
      issue.title,
      issue.body,
      issue.state,
      issue.authorLogin,
      issue.url,
      JSON.stringify(issue.assignees),
      JSON.stringify(issue.labels),
      issue.createdAt,
      issue.updatedAt,
      issue.closedAt,
      issue.lastSyncedAt,
    );
  });
}

export function listGithubIssuesByRepo(repoId: string): GithubIssue[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(
        `SELECT * FROM github_issues WHERE repo_id = ? ORDER BY updated_at DESC`,
      )
      .all(repoId) as Record<string, unknown>[];
    return rows.map(rowToIssue);
  });
}

export function listAllGithubIssues(): GithubIssue[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(`SELECT * FROM github_issues ORDER BY updated_at DESC`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToIssue);
  });
}

export function getGithubIssue(id: string): GithubIssue | null {
  return withGithubDatabase((db) => {
    const row = db
      .prepare(`SELECT * FROM github_issues WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToIssue(row) : null;
  });
}

export function deleteGithubIssuesByRepo(repoId: string): void {
  withGithubDatabase((db) => {
    db.prepare(`DELETE FROM github_issues WHERE repo_id = ?`).run(repoId);
  });
}

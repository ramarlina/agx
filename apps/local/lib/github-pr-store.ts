import type {
  GithubPr,
  GithubPrComment,
  GithubReviewer,
  PrLink,
  PrLinkSource,
  TrackerTargetType,
} from "./github-types";
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

function rowToPr(row: Record<string, unknown>): GithubPr {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    number: Number(row.number),
    title: String(row.title),
    body: String(row.body),
    state: row.state as GithubPr["state"],
    draft: Number(row.draft) === 1,
    authorLogin: String(row.author_login),
    headRef: String(row.head_ref),
    headSha: String(row.head_sha),
    baseRef: String(row.base_ref),
    url: String(row.url),
    ciStatus: (row.ci_status as GithubPr["ciStatus"]) ?? null,
    reviewDecision: (row.review_decision as GithubPr["reviewDecision"]) ?? null,
    assignees: parseJsonArray<string>(row.assignees_json, []),
    reviewers: parseJsonArray<GithubReviewer>(row.reviewers_json, []),
    labels: parseJsonArray<string>(row.labels_json, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    mergedAt: row.merged_at == null ? null : Number(row.merged_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    lastSyncedAt: Number(row.last_synced_at),
  };
}

export function upsertGithubPr(pr: GithubPr): void {
  withGithubDatabase((db) => {
    db.prepare(
      `INSERT INTO github_prs (id, repo_id, number, title, body, state, draft, author_login, head_ref, head_sha, base_ref, url, ci_status, review_decision, assignees_json, reviewers_json, labels_json, created_at, updated_at, merged_at, closed_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         state = excluded.state,
         draft = excluded.draft,
         author_login = excluded.author_login,
         head_ref = excluded.head_ref,
         head_sha = excluded.head_sha,
         base_ref = excluded.base_ref,
         url = excluded.url,
         ci_status = excluded.ci_status,
         review_decision = excluded.review_decision,
         assignees_json = excluded.assignees_json,
         reviewers_json = excluded.reviewers_json,
         labels_json = excluded.labels_json,
         updated_at = excluded.updated_at,
         merged_at = excluded.merged_at,
         closed_at = excluded.closed_at,
         last_synced_at = excluded.last_synced_at`,
    ).run(
      pr.id,
      pr.repoId,
      pr.number,
      pr.title,
      pr.body,
      pr.state,
      pr.draft ? 1 : 0,
      pr.authorLogin,
      pr.headRef,
      pr.headSha,
      pr.baseRef,
      pr.url,
      pr.ciStatus,
      pr.reviewDecision,
      JSON.stringify(pr.assignees),
      JSON.stringify(pr.reviewers),
      JSON.stringify(pr.labels),
      pr.createdAt,
      pr.updatedAt,
      pr.mergedAt,
      pr.closedAt,
      pr.lastSyncedAt,
    );
  });
}

export function getGithubPr(id: string): GithubPr | null {
  return withGithubDatabase((db) => {
    const row = db.prepare(`SELECT * FROM github_prs WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToPr(row) : null;
  });
}

export interface ListGithubPrsInput {
  repoId?: string;
  state?: GithubPr["state"];
  limit?: number;
}

export function listGithubPrs(input: ListGithubPrsInput = {}): GithubPr[] {
  return withGithubDatabase((db) => {
    const clauses: string[] = [];
    const params: (string | number | null)[] = [];
    if (input.repoId) {
      clauses.push("repo_id = ?");
      params.push(input.repoId);
    }
    if (input.state) {
      clauses.push("state = ?");
      params.push(input.state);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = input.limit && input.limit > 0 ? `LIMIT ${Math.min(input.limit, 500)}` : "LIMIT 500";
    const rows = db
      .prepare(`SELECT * FROM github_prs ${where} ORDER BY updated_at DESC ${limit}`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(rowToPr);
  });
}

export function deleteGithubPr(id: string): void {
  withGithubDatabase((db) => {
    db.prepare(`DELETE FROM pr_links WHERE pr_id = ?`).run(id);
    db.prepare(`DELETE FROM github_pr_comments WHERE pr_id = ?`).run(id);
    db.prepare(`DELETE FROM github_prs WHERE id = ?`).run(id);
  });
}

export interface UpsertPrLinkInput {
  prId: string;
  targetType: TrackerTargetType;
  targetId: string;
  linkSource: PrLinkSource;
}

function rowToLink(row: Record<string, unknown>): PrLink {
  return {
    prId: String(row.pr_id),
    targetType: row.target_type as TrackerTargetType,
    targetId: String(row.target_id),
    linkSource: row.link_source as PrLinkSource,
    createdAt: Number(row.created_at),
  };
}

export function upsertPrLink(input: UpsertPrLinkInput): void {
  const now = Date.now();
  withGithubDatabase((db) => {
    db.prepare(
      `INSERT INTO pr_links (pr_id, target_type, target_id, link_source, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(pr_id, target_type, target_id) DO UPDATE SET
         link_source = excluded.link_source`,
    ).run(input.prId, input.targetType, input.targetId, input.linkSource, now);
  });
}

export function listPrLinksForPr(prId: string): PrLink[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(`SELECT * FROM pr_links WHERE pr_id = ? ORDER BY created_at ASC`)
      .all(prId) as Record<string, unknown>[];
    return rows.map(rowToLink);
  });
}

export function listPrLinksForTarget(
  targetType: TrackerTargetType,
  targetId: string,
): PrLink[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(
        `SELECT * FROM pr_links WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC`,
      )
      .all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(rowToLink);
  });
}

export function deleteAutoPrLinks(prId: string): void {
  withGithubDatabase((db) => {
    db.prepare(`DELETE FROM pr_links WHERE pr_id = ? AND link_source != 'manual'`).run(prId);
  });
}

function rowToComment(row: Record<string, unknown>): GithubPrComment {
  return {
    id: String(row.id),
    prId: String(row.pr_id),
    kind: row.kind as GithubPrComment["kind"],
    authorLogin: String(row.author_login),
    body: String(row.body),
    path: (row.path as string | null) ?? null,
    line: row.line == null ? null : Number(row.line),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function upsertPrComments(comments: GithubPrComment[]): void {
  if (comments.length === 0) return;
  withGithubDatabase((db) => {
    const stmt = db.prepare(
      `INSERT INTO github_pr_comments (id, pr_id, kind, author_login, body, path, line, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         body = excluded.body,
         updated_at = excluded.updated_at`,
    );
    for (const c of comments) {
      stmt.run(c.id, c.prId, c.kind, c.authorLogin, c.body, c.path, c.line, c.createdAt, c.updatedAt);
    }
  });
}

export function listPrComments(prId: string): GithubPrComment[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(`SELECT * FROM github_pr_comments WHERE pr_id = ? ORDER BY created_at ASC`)
      .all(prId) as Record<string, unknown>[];
    return rows.map(rowToComment);
  });
}

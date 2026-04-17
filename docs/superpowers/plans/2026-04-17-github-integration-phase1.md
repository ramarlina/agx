# GitHub Integration — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend foundations of the GitHub integration: schema, stores, OAuth client stubs, link resolver, and sync orchestrator — all behind a feature flag, no UI. Unit-tested with mocked HTTP.

**Architecture:** New adapter module under `apps/local/lib/github-*` mirroring the Linear adapter layout. SQLite tables created inline via `withGithubDatabase` helper (matching the `withLinearIssueDatabase` pattern — no versioned migrations). Credentials live at `~/.agx/projects/{projectId}/integrations/github.json` per the existing per-project token convention. Link resolver is tracker-agnostic from day one, resolving across registered stores via a tiny `TrackerItemResolver` interface.

**Tech Stack:** TypeScript (strict, ESM, bundler resolution), Node `node:sqlite` (`DatabaseSync`), Jest (`@jest-environment node`), native `fetch`.

**Spec reference:** `docs/superpowers/specs/2026-04-17-github-integration-design.md`

---

## File Plan

Create:

| Path | Responsibility |
|---|---|
| `apps/local/lib/github-types.ts` | Shared TS types (repo, PR, comment, link, tokens) |
| `apps/local/lib/github-db.ts` | `withGithubDatabase` helper + schema init |
| `apps/local/lib/github-repo-store.ts` | CRUD for `github_repos` |
| `apps/local/lib/github-pr-store.ts` | CRUD for `github_prs`, `github_pr_comments`, `pr_links` |
| `apps/local/lib/github-token-store.ts` | Load/save `github.json` credentials per project |
| `apps/local/lib/github-client.ts` | HTTP client: GitHub REST calls + OAuth proxy via `runagx.com` |
| `apps/local/lib/github-link-resolver.ts` | ID regex + resolution algorithm across registered trackers |
| `apps/local/lib/github-prs.ts` | Sync orchestrator: pull, upsert, invoke resolver |
| `apps/local/__tests__/lib/github-link-resolver.test.ts` | Regex + first-match-wins tests |
| `apps/local/__tests__/lib/github-repo-store.test.ts` | Repo CRUD tests |
| `apps/local/__tests__/lib/github-pr-store.test.ts` | PR/comments/links CRUD + polymorphic query tests |
| `apps/local/__tests__/lib/github-client.test.ts` | HTTP client tests (fetch mocked) |
| `apps/local/__tests__/lib/github-prs.test.ts` | Sync orchestration tests (client + stores mocked) |

Modify: none in Phase 1 (fully additive).

Feature flag: read `process.env.AGX_GITHUB_ENABLED === "1"` at the top of `github-prs.ts` public entrypoints; return no-ops when disabled.

---

## Task 1: Types module

**Files:**
- Create: `apps/local/lib/github-types.ts`

- [ ] **Step 1: Write the file**

```typescript
export type GithubPrState = "open" | "closed" | "merged";
export type GithubCiStatus = "success" | "failure" | "pending" | null;
export type GithubReviewDecision =
  | "approved"
  | "changes_requested"
  | "review_required"
  | null;

export interface GithubRepo {
  id: string; // "owner/repo"
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
  accessRevoked: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

export interface GithubReviewer {
  login: string;
  state: "pending" | "approved" | "changes_requested" | "commented" | "dismissed";
}

export interface GithubPr {
  id: string; // "owner/repo#123"
  repoId: string; // "owner/repo"
  number: number;
  title: string;
  body: string;
  state: GithubPrState;
  draft: boolean;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  url: string;
  ciStatus: GithubCiStatus;
  reviewDecision: GithubReviewDecision;
  assignees: string[];
  reviewers: GithubReviewer[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  mergedAt: number | null;
  closedAt: number | null;
  lastSyncedAt: number;
}

export type PrLinkSource = "branch" | "title" | "body" | "manual";
export type TrackerTargetType = "agx_task" | "linear_issue" | "jira_issue";

export interface PrLink {
  prId: string;
  targetType: TrackerTargetType;
  targetId: string;
  linkSource: PrLinkSource;
  createdAt: number;
}

export type GithubPrCommentKind = "issue_comment" | "review" | "review_comment";

export interface GithubPrComment {
  id: string; // GitHub comment ID (string form)
  prId: string;
  kind: GithubPrCommentKind;
  authorLogin: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GithubTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null; // epoch ms
  login: string;
  scopes: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/local/lib/github-types.ts
git commit -m "feat(github): add shared TypeScript types for GitHub integration"
```

---

## Task 2: DB helper & schema

**Files:**
- Create: `apps/local/lib/github-db.ts`

Mirrors `withLinearIssueDatabase`: opens `~/.agx/github/prs.sqlite` (env override `AGX_GITHUB_DIR`), sets WAL, creates tables.

- [ ] **Step 1: Write the helper**

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const GITHUB_DIR =
  process.env.AGX_GITHUB_DIR?.trim() ||
  path.join(
    process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"),
    "github",
  );

export const GITHUB_DB_PATH = path.join(GITHUB_DIR, "prs.sqlite");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS github_repos (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  access_revoked INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  last_synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS github_prs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  author_login TEXT NOT NULL DEFAULT '',
  head_ref TEXT NOT NULL DEFAULT '',
  head_sha TEXT NOT NULL DEFAULT '',
  base_ref TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  ci_status TEXT,
  review_decision TEXT,
  assignees_json TEXT NOT NULL DEFAULT '[]',
  reviewers_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  merged_at INTEGER,
  closed_at INTEGER,
  last_synced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_prs_repo_updated
  ON github_prs (repo_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_prs_state
  ON github_prs (state, updated_at DESC);

CREATE TABLE IF NOT EXISTS pr_links (
  pr_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pr_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_links_target
  ON pr_links (target_type, target_id);

CREATE TABLE IF NOT EXISTS github_pr_comments (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  author_login TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  path TEXT,
  line INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_pr_comments_pr
  ON github_pr_comments (pr_id);

CREATE TABLE IF NOT EXISTS github_sync_state (
  repo_id TEXT PRIMARY KEY,
  last_synced_at INTEGER NOT NULL,
  cursor TEXT
);
`;

export function withGithubDatabase<T>(run: (db: DatabaseSync) => T): T {
  fs.mkdirSync(GITHUB_DIR, { recursive: true });
  const db = new DatabaseSyncCtor(GITHUB_DB_PATH);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA_SQL);
    return run(db);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/local/lib/github-db.ts
git commit -m "feat(github): add SQLite schema and withGithubDatabase helper"
```

---

## Task 3: Repo store

**Files:**
- Create: `apps/local/lib/github-repo-store.ts`
- Create: `apps/local/__tests__/lib/github-repo-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-repo-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
});

import {
  upsertGithubRepo,
  listGithubRepos,
  removeGithubRepo,
  markRepoSynced,
  markRepoAccessRevoked,
} from "@/lib/github-repo-store";

test("upsert and list", () => {
  upsertGithubRepo({ owner: "foo", name: "bar", defaultBranch: "main", private: true });
  upsertGithubRepo({ owner: "foo", name: "baz", defaultBranch: "main", private: false });
  const all = listGithubRepos();
  expect(all.map((r) => r.id).sort()).toEqual(["foo/bar", "foo/baz"]);
  expect(all.find((r) => r.id === "foo/bar")?.private).toBe(true);
});

test("upsert is idempotent and updates mutable fields", () => {
  upsertGithubRepo({ owner: "foo", name: "bar", defaultBranch: "develop", private: false });
  const rec = listGithubRepos().find((r) => r.id === "foo/bar");
  expect(rec?.defaultBranch).toBe("develop");
  expect(rec?.private).toBe(false);
});

test("markRepoSynced sets last_synced_at", () => {
  markRepoSynced("foo/bar", 1234567);
  const rec = listGithubRepos().find((r) => r.id === "foo/bar");
  expect(rec?.lastSyncedAt).toBe(1234567);
});

test("markRepoAccessRevoked flips flag", () => {
  markRepoAccessRevoked("foo/bar", true);
  expect(listGithubRepos().find((r) => r.id === "foo/bar")?.accessRevoked).toBe(true);
  markRepoAccessRevoked("foo/bar", false);
  expect(listGithubRepos().find((r) => r.id === "foo/bar")?.accessRevoked).toBe(false);
});

test("remove deletes the row", () => {
  removeGithubRepo("foo/bar");
  expect(listGithubRepos().map((r) => r.id)).toEqual(["foo/baz"]);
});
```

- [ ] **Step 2: Run tests (expect module-not-found / failures)**

```bash
cd apps/local && npx jest __tests__/lib/github-repo-store.test.ts
```

- [ ] **Step 3: Implement the store**

```typescript
import type { GithubRepo } from "./github-types";
import { withGithubDatabase } from "./github-db";

export interface UpsertGithubRepoInput {
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
}

function rowToRepo(row: Record<string, unknown>): GithubRepo {
  return {
    id: String(row.id),
    owner: String(row.owner),
    name: String(row.name),
    defaultBranch: (row.default_branch as string | null) ?? null,
    private: Number(row.private) === 1,
    accessRevoked: Number(row.access_revoked) === 1,
    addedAt: Number(row.added_at),
    lastSyncedAt: row.last_synced_at == null ? null : Number(row.last_synced_at),
  };
}

export function upsertGithubRepo(input: UpsertGithubRepoInput): GithubRepo {
  const id = `${input.owner}/${input.name}`;
  const now = Date.now();
  return withGithubDatabase((db) => {
    db.prepare(
      `INSERT INTO github_repos (id, owner, name, default_branch, private, access_revoked, added_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         default_branch = excluded.default_branch,
         private = excluded.private`,
    ).run(id, input.owner, input.name, input.defaultBranch, input.private ? 1 : 0, now);
    const row = db.prepare(`SELECT * FROM github_repos WHERE id = ?`).get(id) as Record<string, unknown>;
    return rowToRepo(row);
  });
}

export function listGithubRepos(): GithubRepo[] {
  return withGithubDatabase((db) => {
    const rows = db.prepare(`SELECT * FROM github_repos ORDER BY id ASC`).all() as Record<string, unknown>[];
    return rows.map(rowToRepo);
  });
}

export function removeGithubRepo(id: string): void {
  withGithubDatabase((db) => {
    db.prepare(`DELETE FROM github_repos WHERE id = ?`).run(id);
  });
}

export function markRepoSynced(id: string, syncedAt: number): void {
  withGithubDatabase((db) => {
    db.prepare(`UPDATE github_repos SET last_synced_at = ? WHERE id = ?`).run(syncedAt, id);
  });
}

export function markRepoAccessRevoked(id: string, revoked: boolean): void {
  withGithubDatabase((db) => {
    db.prepare(`UPDATE github_repos SET access_revoked = ? WHERE id = ?`).run(revoked ? 1 : 0, id);
  });
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/local && npx jest __tests__/lib/github-repo-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/local/lib/github-repo-store.ts apps/local/__tests__/lib/github-repo-store.test.ts
git commit -m "feat(github): add repo store with CRUD + tests"
```

---

## Task 4: PR + comment + link store

**Files:**
- Create: `apps/local/lib/github-pr-store.ts`
- Create: `apps/local/__tests__/lib/github-pr-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-pr-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
});

import {
  upsertGithubPr,
  getGithubPr,
  listGithubPrs,
  deleteGithubPr,
  upsertPrLink,
  listPrLinksForPr,
  listPrLinksForTarget,
  deleteAutoPrLinks,
  upsertPrComments,
  listPrComments,
} from "@/lib/github-pr-store";
import type { GithubPr } from "@/lib/github-types";

const basePr: GithubPr = {
  id: "foo/bar#1",
  repoId: "foo/bar",
  number: 1,
  title: "Feat: do thing",
  body: "fixes AGX-42",
  state: "open",
  draft: false,
  authorLogin: "alice",
  headRef: "feat/agx-42",
  headSha: "deadbeef",
  baseRef: "main",
  url: "https://github.com/foo/bar/pull/1",
  ciStatus: "success",
  reviewDecision: "review_required",
  assignees: ["alice"],
  reviewers: [{ login: "bob", state: "pending" }],
  labels: ["feature"],
  createdAt: 1,
  updatedAt: 2,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 3,
};

test("upsert + get round-trip preserves JSON fields", () => {
  upsertGithubPr(basePr);
  const got = getGithubPr("foo/bar#1");
  expect(got).toEqual(basePr);
});

test("list scopes by repo", () => {
  upsertGithubPr({ ...basePr, id: "foo/bar#2", number: 2, title: "Another" });
  upsertGithubPr({ ...basePr, id: "other/x#1", number: 1, repoId: "other/x" });
  const foo = listGithubPrs({ repoId: "foo/bar" });
  expect(foo.map((p) => p.id).sort()).toEqual(["foo/bar#1", "foo/bar#2"]);
});

test("pr_links upsert + list by pr", () => {
  upsertPrLink({ prId: "foo/bar#1", targetType: "agx_task", targetId: "AGX-42", linkSource: "body" });
  upsertPrLink({ prId: "foo/bar#1", targetType: "linear_issue", targetId: "LIN-7", linkSource: "manual" });
  const links = listPrLinksForPr("foo/bar#1");
  expect(links).toHaveLength(2);
});

test("pr_links list by target", () => {
  const links = listPrLinksForTarget("agx_task", "AGX-42");
  expect(links.map((l) => l.prId)).toEqual(["foo/bar#1"]);
});

test("deleteAutoPrLinks leaves manual links alone", () => {
  deleteAutoPrLinks("foo/bar#1");
  const links = listPrLinksForPr("foo/bar#1");
  expect(links).toHaveLength(1);
  expect(links[0].linkSource).toBe("manual");
});

test("comments upsert + list", () => {
  upsertPrComments([
    {
      id: "c1",
      prId: "foo/bar#1",
      kind: "issue_comment",
      authorLogin: "bob",
      body: "nit",
      path: null,
      line: null,
      createdAt: 10,
      updatedAt: 10,
    },
    {
      id: "c2",
      prId: "foo/bar#1",
      kind: "review_comment",
      authorLogin: "carol",
      body: "extract regex",
      path: "src/a.ts",
      line: 42,
      createdAt: 11,
      updatedAt: 11,
    },
  ]);
  const comments = listPrComments("foo/bar#1");
  expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  expect(comments[1].line).toBe(42);
});

test("deleteGithubPr cascades links and comments", () => {
  deleteGithubPr("foo/bar#1");
  expect(getGithubPr("foo/bar#1")).toBeNull();
  expect(listPrLinksForPr("foo/bar#1")).toHaveLength(0);
  expect(listPrComments("foo/bar#1")).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
cd apps/local && npx jest __tests__/lib/github-pr-store.test.ts
```

- [ ] **Step 3: Implement the store**

```typescript
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
    const params: unknown[] = [];
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
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/local && npx jest __tests__/lib/github-pr-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/local/lib/github-pr-store.ts apps/local/__tests__/lib/github-pr-store.test.ts
git commit -m "feat(github): add PR/comment/link store with polymorphic link queries"
```

---

## Task 5: Token store

**Files:**
- Create: `apps/local/lib/github-token-store.ts`

Stores tokens per project at `~/.agx/projects/{projectId}/integrations/github.json`, matching the existing Linear pattern.

- [ ] **Step 1: Implement**

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GithubTokens } from "./github-types";

function projectTokenPath(projectId: string): string {
  const base =
    process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx");
  return path.join(base, "projects", projectId, "integrations", "github.json");
}

export function saveGithubTokens(projectId: string, tokens: GithubTokens): void {
  const p = projectTokenPath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function loadGithubTokens(projectId: string): GithubTokens | null {
  const p = projectTokenPath(projectId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as GithubTokens;
    if (typeof parsed.accessToken !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGithubTokens(projectId: string): void {
  const p = projectTokenPath(projectId);
  if (fs.existsSync(p)) fs.rmSync(p);
}

export function githubTokensExpired(tokens: GithubTokens, skewMs = 60_000): boolean {
  if (tokens.expiresAt == null) return false;
  return Date.now() >= tokens.expiresAt - skewMs;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/local/lib/github-token-store.ts
git commit -m "feat(github): add per-project GitHub token store"
```

---

## Task 6: Link resolver

**Files:**
- Create: `apps/local/lib/github-link-resolver.ts`
- Create: `apps/local/__tests__/lib/github-link-resolver.test.ts`

Implements: extract `[A-Z]+-\d+` IDs from branch → title → body (in that order), iterate IDs in first-seen order, resolve across registered tracker resolvers, **stop on first hit**. Persist result to `pr_links`.

- [ ] **Step 1: Write failing tests**

```typescript
/** @jest-environment node */
import {
  extractTrackerIds,
  resolvePrLink,
  ID_PATTERN,
} from "@/lib/github-link-resolver";

test("regex rejects mid-word and lowercase-prefix", () => {
  expect("abc-123".match(ID_PATTERN)).toBeNull();
  expect("FOOBAR1-2BAR".match(ID_PATTERN)).toBeNull();
  expect("FOO-1".match(ID_PATTERN)?.[0]).toBe("FOO-1");
  expect("fix: AGX-42 and LIN-7".match(new RegExp(ID_PATTERN, "g"))).toEqual([
    "AGX-42",
    "LIN-7",
  ]);
});

test("extractTrackerIds walks fields in order", () => {
  const ids = extractTrackerIds({
    headRef: "agx/AGX-1-fix",
    title: "fix: addresses LIN-2",
    body: "closes AGX-3",
  });
  expect(ids.map((i) => i.id)).toEqual(["AGX-1", "LIN-2", "AGX-3"]);
  expect(ids.map((i) => i.source)).toEqual(["branch", "title", "body"]);
});

test("resolvePrLink returns first resolvable id", async () => {
  const resolver = async (id: string) =>
    id === "LIN-2" ? { targetType: "linear_issue" as const, targetId: "LIN-2" } : null;
  const result = await resolvePrLink(
    { headRef: "no-match", title: "LIN-2 and AGX-1", body: "AGX-1" },
    [resolver],
  );
  expect(result).toEqual({
    targetType: "linear_issue",
    targetId: "LIN-2",
    linkSource: "title",
  });
});

test("resolvePrLink returns null when nothing resolves", async () => {
  const resolver = async () => null;
  const result = await resolvePrLink(
    { headRef: "feat/x", title: "no ids", body: "" },
    [resolver],
  );
  expect(result).toBeNull();
});

test("first field with a resolvable id wins", async () => {
  const resolver = async (id: string) =>
    id === "AGX-9" ? { targetType: "agx_task" as const, targetId: "AGX-9" } : null;
  const result = await resolvePrLink(
    { headRef: "branch-with-AGX-9", title: "also AGX-9", body: "yet again AGX-9" },
    [resolver],
  );
  expect(result?.linkSource).toBe("branch");
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
cd apps/local && npx jest __tests__/lib/github-link-resolver.test.ts
```

- [ ] **Step 3: Implement the resolver**

```typescript
import type { PrLinkSource, TrackerTargetType } from "./github-types";

export const ID_PATTERN = /(?<![A-Za-z0-9])[A-Z]+-\d+(?![A-Za-z0-9])/i;
const ID_PATTERN_GLOBAL = new RegExp(ID_PATTERN, "g");

export interface ExtractedId {
  id: string;
  source: Exclude<PrLinkSource, "manual">;
}

export interface PrLinkInput {
  headRef: string;
  title: string;
  body: string;
}

export function extractTrackerIds(input: PrLinkInput): ExtractedId[] {
  const out: ExtractedId[] = [];
  const seen = new Set<string>();
  const fields: Array<[string, ExtractedId["source"]]> = [
    [input.headRef, "branch"],
    [input.title, "title"],
    [input.body, "body"],
  ];
  for (const [text, source] of fields) {
    const matches = text.match(ID_PATTERN_GLOBAL) ?? [];
    for (const raw of matches) {
      const id = raw.toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, source });
    }
  }
  return out;
}

export type TrackerResolver = (
  id: string,
) => Promise<{ targetType: TrackerTargetType; targetId: string } | null>;

export interface ResolvedPrLink {
  targetType: TrackerTargetType;
  targetId: string;
  linkSource: Exclude<PrLinkSource, "manual">;
}

export async function resolvePrLink(
  input: PrLinkInput,
  resolvers: TrackerResolver[],
): Promise<ResolvedPrLink | null> {
  const ids = extractTrackerIds(input);
  for (const extracted of ids) {
    for (const resolver of resolvers) {
      const match = await resolver(extracted.id);
      if (match) {
        return {
          targetType: match.targetType,
          targetId: match.targetId,
          linkSource: extracted.source,
        };
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/local && npx jest __tests__/lib/github-link-resolver.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/local/lib/github-link-resolver.ts apps/local/__tests__/lib/github-link-resolver.test.ts
git commit -m "feat(github): add tracker-agnostic PR link resolver"
```

---

## Task 7: GitHub HTTP client

**Files:**
- Create: `apps/local/lib/github-client.ts`
- Create: `apps/local/__tests__/lib/github-client.test.ts`

Thin REST client that:
- Refreshes tokens via `https://www.runagx.com/api/github/refresh` when expired
- Fetches PRs updated since a cursor (`GET /repos/{owner}/{name}/pulls?state=all&sort=updated&direction=desc`)
- Fetches PR comments (issue + review comments)
- Returns domain records mapped to `GithubPr` / `GithubPrComment`

Tests inject a `fetch` via constructor to keep them offline.

- [ ] **Step 1: Write failing tests**

```typescript
/** @jest-environment node */
import { GithubClient } from "@/lib/github-client";
import type { GithubTokens } from "@/lib/github-types";

const tokens: GithubTokens = {
  accessToken: "token",
  refreshToken: null,
  expiresAt: null,
  login: "tester",
  scopes: ["repo"],
};

function makeFetch(responses: Array<{ url: RegExp; body: unknown; status?: number }>) {
  return async (url: string, _init?: RequestInit): Promise<Response> => {
    for (const r of responses) {
      if (r.url.test(url)) {
        return new Response(JSON.stringify(r.body), {
          status: r.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ message: "not mocked" }), { status: 500 });
  };
}

test("listPullRequests maps REST response to GithubPr[]", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      {
        url: /\/repos\/foo\/bar\/pulls/,
        body: [
          {
            id: 1,
            number: 7,
            title: "t",
            body: "fixes AGX-1",
            state: "open",
            draft: false,
            user: { login: "alice" },
            head: { ref: "agx/AGX-1", sha: "abc" },
            base: { ref: "main" },
            html_url: "https://example/pr/7",
            assignees: [{ login: "alice" }],
            requested_reviewers: [{ login: "bob" }],
            labels: [{ name: "feature" }],
            created_at: "2026-04-17T10:00:00Z",
            updated_at: "2026-04-17T11:00:00Z",
            merged_at: null,
            closed_at: null,
          },
        ],
      },
    ]),
  });
  const prs = await client.listPullRequests({ owner: "foo", name: "bar" });
  expect(prs).toHaveLength(1);
  expect(prs[0].id).toBe("foo/bar#7");
  expect(prs[0].headRef).toBe("agx/AGX-1");
  expect(prs[0].reviewers.map((r) => r.login)).toEqual(["bob"]);
});

test("listPullRequestComments returns issue + review comments", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      {
        url: /\/repos\/foo\/bar\/issues\/7\/comments/,
        body: [
          {
            id: 100,
            user: { login: "alice" },
            body: "lgtm",
            created_at: "2026-04-17T10:00:00Z",
            updated_at: "2026-04-17T10:00:00Z",
          },
        ],
      },
      {
        url: /\/repos\/foo\/bar\/pulls\/7\/comments/,
        body: [
          {
            id: 200,
            user: { login: "bob" },
            body: "extract regex",
            path: "src/a.ts",
            line: 42,
            created_at: "2026-04-17T10:05:00Z",
            updated_at: "2026-04-17T10:05:00Z",
          },
        ],
      },
    ]),
  });
  const comments = await client.listPullRequestComments({
    owner: "foo",
    name: "bar",
    number: 7,
  });
  expect(comments).toHaveLength(2);
  expect(comments.map((c) => c.kind).sort()).toEqual(["issue_comment", "review_comment"]);
  expect(comments.find((c) => c.kind === "review_comment")?.line).toBe(42);
});

test("401 surfaces as AuthError", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      { url: /\/repos\//, body: { message: "Bad credentials" }, status: 401 },
    ]),
  });
  await expect(client.listPullRequests({ owner: "foo", name: "bar" })).rejects.toThrow(
    /auth/i,
  );
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
cd apps/local && npx jest __tests__/lib/github-client.test.ts
```

- [ ] **Step 3: Implement**

```typescript
import type {
  GithubPr,
  GithubPrComment,
  GithubTokens,
  GithubReviewer,
} from "./github-types";

export class GithubAuthError extends Error {
  constructor(message = "github auth failed") {
    super(message);
    this.name = "GithubAuthError";
  }
}

export class GithubRateLimitError extends Error {
  constructor(public resetAt: number) {
    super("github rate limited");
    this.name = "GithubRateLimitError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GithubClientInit {
  tokens: GithubTokens;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
}

interface RawPull {
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  assignees?: Array<{ login: string }>;
  requested_reviewers?: Array<{ login: string }>;
  labels?: Array<{ name: string }>;
}

interface RawIssueComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

interface RawReviewComment extends RawIssueComment {
  path: string;
  line: number | null;
}

function toEpoch(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : 0;
}

function mapReviewers(list: RawPull["requested_reviewers"]): GithubReviewer[] {
  return (list ?? []).map((r) => ({ login: r.login, state: "pending" as const }));
}

function mapPr(owner: string, name: string, raw: RawPull, syncedAt: number): GithubPr {
  const merged = raw.merged_at != null;
  const closed = raw.closed_at != null;
  const state: GithubPr["state"] = merged ? "merged" : closed ? "closed" : "open";
  return {
    id: `${owner}/${name}#${raw.number}`,
    repoId: `${owner}/${name}`,
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    state,
    draft: Boolean(raw.draft),
    authorLogin: raw.user?.login ?? "",
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    url: raw.html_url,
    ciStatus: null,
    reviewDecision: null,
    assignees: (raw.assignees ?? []).map((a) => a.login),
    reviewers: mapReviewers(raw.requested_reviewers),
    labels: (raw.labels ?? []).map((l) => l.name),
    createdAt: toEpoch(raw.created_at),
    updatedAt: toEpoch(raw.updated_at),
    mergedAt: merged ? toEpoch(raw.merged_at) : null,
    closedAt: closed ? toEpoch(raw.closed_at) : null,
    lastSyncedAt: syncedAt,
  };
}

export class GithubClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly tokens: GithubTokens;
  private readonly userAgent: string;

  constructor(init: GithubClientInit) {
    this.tokens = init.tokens;
    this.fetchImpl = init.fetchImpl ?? ((url, opts) => fetch(url, opts));
    this.baseUrl = init.baseUrl ?? "https://api.github.com";
    this.userAgent = init.userAgent ?? "agx-github-client";
  }

  private async request<T>(pathname: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "User-Agent": this.userAgent,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 401) throw new GithubAuthError();
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000;
        throw new GithubRateLimitError(reset);
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`github ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async listPullRequests(input: {
    owner: string;
    name: string;
    state?: "all" | "open" | "closed";
    perPage?: number;
  }): Promise<GithubPr[]> {
    const params = new URLSearchParams({
      state: input.state ?? "all",
      sort: "updated",
      direction: "desc",
      per_page: String(input.perPage ?? 50),
    });
    const raw = await this.request<RawPull[]>(
      `/repos/${input.owner}/${input.name}/pulls?${params}`,
    );
    const now = Date.now();
    return raw.map((r) => mapPr(input.owner, input.name, r, now));
  }

  async listPullRequestComments(input: {
    owner: string;
    name: string;
    number: number;
  }): Promise<GithubPrComment[]> {
    const prId = `${input.owner}/${input.name}#${input.number}`;
    const [issueComments, reviewComments] = await Promise.all([
      this.request<RawIssueComment[]>(
        `/repos/${input.owner}/${input.name}/issues/${input.number}/comments`,
      ),
      this.request<RawReviewComment[]>(
        `/repos/${input.owner}/${input.name}/pulls/${input.number}/comments`,
      ),
    ]);
    const mapped: GithubPrComment[] = [];
    for (const c of issueComments) {
      mapped.push({
        id: String(c.id),
        prId,
        kind: "issue_comment",
        authorLogin: c.user?.login ?? "",
        body: c.body ?? "",
        path: null,
        line: null,
        createdAt: toEpoch(c.created_at),
        updatedAt: toEpoch(c.updated_at),
      });
    }
    for (const c of reviewComments) {
      mapped.push({
        id: String(c.id),
        prId,
        kind: "review_comment",
        authorLogin: c.user?.login ?? "",
        body: c.body ?? "",
        path: c.path ?? null,
        line: c.line ?? null,
        createdAt: toEpoch(c.created_at),
        updatedAt: toEpoch(c.updated_at),
      });
    }
    return mapped;
  }
}

export interface RefreshTokensInput {
  refreshToken: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

export async function refreshGithubTokens(
  input: RefreshTokensInput,
): Promise<GithubTokens> {
  const fetchImpl = input.fetchImpl ?? ((url, opts) => fetch(url, opts));
  const endpoint = input.endpoint ?? "https://www.runagx.com/api/github/refresh";
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: input.refreshToken }),
  });
  if (!res.ok) throw new GithubAuthError(`refresh failed ${res.status}`);
  return (await res.json()) as GithubTokens;
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/local && npx jest __tests__/lib/github-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/local/lib/github-client.ts apps/local/__tests__/lib/github-client.test.ts
git commit -m "feat(github): add REST client with fetch injection for tests"
```

---

## Task 8: Sync orchestrator

**Files:**
- Create: `apps/local/lib/github-prs.ts`
- Create: `apps/local/__tests__/lib/github-prs.test.ts`

Orchestrator that, given a repo and a `GithubClient`, pulls PRs, upserts them, re-runs link resolution on each changed PR, and writes `pr_links`. Respects the `AGX_GITHUB_ENABLED` feature flag.

- [ ] **Step 1: Write failing tests**

```typescript
/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-sync-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
  process.env.AGX_GITHUB_ENABLED = "1";
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
  delete process.env.AGX_GITHUB_ENABLED;
});

import { upsertGithubRepo, listGithubRepos } from "@/lib/github-repo-store";
import { listGithubPrs, listPrLinksForPr } from "@/lib/github-pr-store";
import { syncRepo } from "@/lib/github-prs";
import type { GithubPr } from "@/lib/github-types";

const fakePr: GithubPr = {
  id: "foo/bar#7",
  repoId: "foo/bar",
  number: 7,
  title: "fix",
  body: "addresses AGX-42",
  state: "open",
  draft: false,
  authorLogin: "alice",
  headRef: "agx/AGX-42-fix",
  headSha: "sha",
  baseRef: "main",
  url: "https://example/pr/7",
  ciStatus: null,
  reviewDecision: null,
  assignees: [],
  reviewers: [],
  labels: [],
  createdAt: 10,
  updatedAt: 20,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 30,
};

test("syncRepo upserts PRs and writes resolved link via first-hit resolver", async () => {
  upsertGithubRepo({ owner: "foo", name: "bar", defaultBranch: "main", private: false });
  const client = {
    listPullRequests: jest.fn().mockResolvedValue([fakePr]),
  };
  const resolver = jest.fn(async (id: string) =>
    id === "AGX-42" ? { targetType: "agx_task" as const, targetId: "AGX-42" } : null,
  );
  await syncRepo({ repoId: "foo/bar", client: client as any, resolvers: [resolver] });
  const stored = listGithubPrs({ repoId: "foo/bar" });
  expect(stored).toHaveLength(1);
  const links = listPrLinksForPr("foo/bar#7");
  expect(links).toEqual([
    expect.objectContaining({
      targetType: "agx_task",
      targetId: "AGX-42",
      linkSource: "branch",
    }),
  ]);
  expect(listGithubRepos().find((r) => r.id === "foo/bar")?.lastSyncedAt).toBeGreaterThan(0);
});

test("syncRepo is no-op when feature flag disabled", async () => {
  process.env.AGX_GITHUB_ENABLED = "0";
  const client = { listPullRequests: jest.fn() };
  await syncRepo({ repoId: "foo/bar", client: client as any, resolvers: [] });
  expect(client.listPullRequests).not.toHaveBeenCalled();
  process.env.AGX_GITHUB_ENABLED = "1";
});

test("syncRepo re-resolves links when PR body changes", async () => {
  const client = {
    listPullRequests: jest.fn().mockResolvedValue([
      { ...fakePr, headRef: "feat/x", title: "retitled", body: "now LIN-9" },
    ]),
  };
  const resolver = jest.fn(async (id: string) =>
    id === "LIN-9" ? { targetType: "linear_issue" as const, targetId: "LIN-9" } : null,
  );
  await syncRepo({ repoId: "foo/bar", client: client as any, resolvers: [resolver] });
  const links = listPrLinksForPr("foo/bar#7");
  expect(links).toHaveLength(1);
  expect(links[0]).toEqual(
    expect.objectContaining({
      targetType: "linear_issue",
      targetId: "LIN-9",
      linkSource: "body",
    }),
  );
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
cd apps/local && npx jest __tests__/lib/github-prs.test.ts
```

- [ ] **Step 3: Implement**

```typescript
import { GithubClient } from "./github-client";
import { upsertGithubPr, deleteAutoPrLinks, upsertPrLink } from "./github-pr-store";
import { markRepoSynced } from "./github-repo-store";
import { resolvePrLink, type TrackerResolver } from "./github-link-resolver";
import type { GithubPr } from "./github-types";

export interface SyncRepoInput {
  repoId: string;
  client: Pick<GithubClient, "listPullRequests">;
  resolvers: TrackerResolver[];
}

function isEnabled(): boolean {
  return process.env.AGX_GITHUB_ENABLED === "1";
}

function parseRepoId(repoId: string): { owner: string; name: string } {
  const [owner, name] = repoId.split("/");
  if (!owner || !name) throw new Error(`invalid repoId ${repoId}`);
  return { owner, name };
}

export async function syncRepo(input: SyncRepoInput): Promise<void> {
  if (!isEnabled()) return;
  const { owner, name } = parseRepoId(input.repoId);
  const prs = await input.client.listPullRequests({ owner, name });
  for (const pr of prs) {
    await upsertAndResolve(pr, input.resolvers);
  }
  markRepoSynced(input.repoId, Date.now());
}

async function upsertAndResolve(pr: GithubPr, resolvers: TrackerResolver[]): Promise<void> {
  upsertGithubPr(pr);
  const resolved = await resolvePrLink(
    { headRef: pr.headRef, title: pr.title, body: pr.body },
    resolvers,
  );
  deleteAutoPrLinks(pr.id);
  if (resolved) {
    upsertPrLink({
      prId: pr.id,
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      linkSource: resolved.linkSource,
    });
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/local && npx jest __tests__/lib/github-prs.test.ts
```

- [ ] **Step 5: Run full github test suite**

```bash
cd apps/local && npx jest __tests__/lib/github-
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/local/lib/github-prs.ts apps/local/__tests__/lib/github-prs.test.ts
git commit -m "feat(github): add sync orchestrator wiring client + stores + resolver"
```

---

## Final

- [ ] **Run `/commit`** to capture any stragglers (should be a no-op).
- [ ] **Run `/push`** to push `feat/github-integration`.
- [ ] **Update RESUME.md** to mark Phase 1 complete and list what's deferred to Phase 2+.

---

## Out of scope for Phase 1 (follow-up plans)

- OAuth device-code/browser flow integration on the desktop — Phase 1 ships token store + refresh only; the interactive flow plumbs through `agx-web` and wants its own plan.
- `agx-web` OAuth handler (`/api/github/callback`, `/api/github/refresh`) — separate repo.
- CI status and review decision fetching (`GET /repos/.../commits/{sha}/check-runs`, `GET /repos/.../pulls/{n}/reviews`) — additive.
- Polling loop & post-push hook — separate plan; orchestrator is already callable ad-hoc.
- UI: `/prs` route, task detail section, settings pane, row indicators.
- Integration with agx task store and Linear store resolvers (wire the actual `TrackerResolver` impls) — currently the resolver interface is defined; real impls are Phase 2.

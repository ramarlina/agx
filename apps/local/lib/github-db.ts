import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const { DatabaseSync: DatabaseSyncCtor } = process.getBuiltinModule(
  "node:sqlite",
) as typeof import("node:sqlite");

function resolveGithubDir(): string {
  return (
    process.env.AGX_GITHUB_DIR?.trim() ||
    path.join(
      process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"),
      "github",
    )
  );
}

export function getGithubDbPath(): string {
  return path.join(resolveGithubDir(), "prs.sqlite");
}

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

CREATE TABLE IF NOT EXISTS github_issues (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  author_login TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  assignees_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  last_synced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_issues_repo_updated
  ON github_issues (repo_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_issues_state
  ON github_issues (state, updated_at DESC);

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
  const dir = resolveGithubDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSyncCtor(getGithubDbPath());
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA_SQL);
    return run(db);
  } finally {
    db.close();
  }
}

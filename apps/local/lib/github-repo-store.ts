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

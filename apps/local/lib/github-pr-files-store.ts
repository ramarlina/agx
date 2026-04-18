import type { GithubPrFile } from "./github-types";
import { withGithubDatabase } from "./github-db";

function rowToFile(row: Record<string, unknown>): GithubPrFile {
  return {
    prId: String(row.pr_id),
    path: String(row.path),
    status: String(row.status),
    additions: Number(row.additions),
    deletions: Number(row.deletions),
    changes: Number(row.changes),
    patch: (row.patch as string | null) ?? null,
    lastSyncedAt: Number(row.last_synced_at),
  };
}

export function upsertPrFiles(files: GithubPrFile[]): void {
  if (files.length === 0) return;
  withGithubDatabase((db) => {
    const stmt = db.prepare(
      `INSERT INTO github_pr_files (pr_id, path, status, additions, deletions, changes, patch, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pr_id, path) DO UPDATE SET
         status = excluded.status,
         additions = excluded.additions,
         deletions = excluded.deletions,
         changes = excluded.changes,
         patch = excluded.patch,
         last_synced_at = excluded.last_synced_at`,
    );
    for (const f of files) {
      stmt.run(
        f.prId,
        f.path,
        f.status,
        f.additions,
        f.deletions,
        f.changes,
        f.patch,
        f.lastSyncedAt,
      );
    }
  });
}

export function listPrFiles(prId: string): GithubPrFile[] {
  return withGithubDatabase((db) => {
    const rows = db
      .prepare(`SELECT * FROM github_pr_files WHERE pr_id = ? ORDER BY path ASC`)
      .all(prId) as Record<string, unknown>[];
    return rows.map(rowToFile);
  });
}

export function deletePrFiles(prId: string): void {
  withGithubDatabase((db) => {
    db.prepare(`DELETE FROM github_pr_files WHERE pr_id = ?`).run(prId);
  });
}

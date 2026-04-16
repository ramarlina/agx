/**
 * Compatibility helpers for migrating from better-sqlite3 to node:sqlite.
 *
 * Provides pragma() and transaction() helpers that match
 * the better-sqlite3 API surface used throughout agx-cloud.
 *
 * For backups, use the module-level `backup()` from "node:sqlite" directly.
 */
import type { DatabaseSync } from "node:sqlite";

/**
 * Read a PRAGMA value, returning the value directly (like better-sqlite3's simple mode).
 * Example: pragmaGet(db, "journal_mode") => "wal"
 */
export function pragmaGet(db: DatabaseSync, key: string): unknown {
  const row = db.prepare(`PRAGMA ${key}`).get() as Record<string, unknown> | undefined;
  if (!row) return undefined;
  // Return the first column value regardless of column name.
  // Some PRAGMAs use a different column name than the key (e.g. busy_timeout → timeout).
  const values = Object.values(row);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Read a PRAGMA that returns multiple rows (like table_info, foreign_key_check).
 * Example: pragmaAll(db, "table_info(agents)") => [{ cid: 0, name: "id", ... }]
 */
export function pragmaAll(db: DatabaseSync, key: string): unknown[] {
  return db.prepare(`PRAGMA ${key}`).all();
}

/**
 * Set a PRAGMA value.
 * Example: pragmaSet(db, "journal_mode = WAL")
 */
export function pragmaSet(db: DatabaseSync, pragma: string): void {
  db.exec(`PRAGMA ${pragma}`);
}

/**
 * Run a function inside a transaction. Mimics better-sqlite3's db.transaction() API.
 * Automatically commits on success, rolls back on error.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Returns a reusable transaction wrapper (like better-sqlite3's db.transaction(fn)).
 * The returned function accepts args and passes them to fn.
 */
export function transactionFn<TArgs extends unknown[], TResult>(
  db: DatabaseSync,
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
}

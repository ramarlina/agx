import { DatabaseSync } from "node:sqlite";
import { pragmaGet, pragmaSet } from "@/lib/sqlite-compat";
import { checkVersion, checkExtensions, checkFilesystem } from "./checks";
import { DB_BUSY_TIMEOUT_MS } from "@/lib/constants/timing";

export interface InitOptions {
  /** Require FTS5 extension (default: false) */
  requireFts5?: boolean;
  /** Strict filesystem check — throw instead of warn on network FS (default: false) */
  strictFsCheck?: boolean;
  /** busy_timeout in milliseconds (default: 5000) */
  busyTimeout?: number;
  /** synchronous level (default: NORMAL — safe with WAL) */
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  /** cache_size in KiB (negative = KiB, positive = pages). Default: -64000 (~64 MB) */
  cacheSize?: number;
}

/**
 * Apply the required PRAGMA contract to a database connection.
 *
 * §0.1 contract:
 * - journal_mode = WAL
 * - foreign_keys = ON
 * - busy_timeout = 5000
 * - synchronous = NORMAL
 * - cache_size = -64000
 */
export function applyPragmas(db: DatabaseSync, opts?: InitOptions): void {
  pragmaSet(db, "journal_mode = WAL");
  const jm = (pragmaGet(db, "journal_mode") as string).toLowerCase();
  if (jm !== "wal") {
    // WAL unavailable (network FS, locked) — fall back to DELETE
    pragmaSet(db, "journal_mode = DELETE");
    pragmaSet(db, "synchronous = FULL");
    console.warn(`[db/init] WAL unavailable (got '${jm}'), using DELETE with synchronous=FULL`);
  } else {
    pragmaSet(db, `synchronous = ${opts?.synchronous ?? "NORMAL"}`);
  }
  pragmaSet(db, "foreign_keys = ON");
  pragmaSet(db, `busy_timeout = ${opts?.busyTimeout ?? DB_BUSY_TIMEOUT_MS}`);
  pragmaSet(db, `cache_size = ${opts?.cacheSize ?? -64000}`);
}

/**
 * Open and initialize a database with all required checks and PRAGMAs.
 *
 * Fails fast if:
 * - SQLite version < 3.35.0
 * - JSON1 extension missing
 * - FTS5 missing (when requireFts5 is true)
 * - Database on network filesystem (when strictFsCheck is true)
 */
export function initDatabase(
  dbPath: string,
  opts?: InitOptions
): DatabaseSync {
  // Filesystem check before opening
  checkFilesystem(dbPath, { strict: opts?.strictFsCheck });

  const db = new DatabaseSync(dbPath);

  try {
    // Version & extension checks
    checkVersion(db);
    checkExtensions(db, { requireFts5: opts?.requireFts5 });

    // Apply PRAGMAs
    applyPragmas(db, opts);
  } catch (err) {
    db.close();
    throw err;
  }

  return db;
}

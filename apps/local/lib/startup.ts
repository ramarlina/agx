/**
 * SQLite Runtime Environment Contract — §0.1
 *
 * Startup checks that fail fast on configuration mismatch.
 * Import and call `validateSQLiteEnvironment(db)` before any query execution.
 */

import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { pragmaGet, pragmaSet } from "./sqlite-compat";
import fs from "fs";
import os from "os";
import path from "path";

// ── Contract constants ──────────────────────────────────────────────────────

/** Minimum SQLite version: 3.35.0 (RETURNING clause support) */
export const MIN_SQLITE_VERSION = "3.35.0";

/** Required PRAGMAs applied at connection open */
export const REQUIRED_PRAGMAS = {
  journal_mode: "wal",
  foreign_keys: 1,
  busy_timeout: 5000,
  synchronous: 1, // NORMAL — safe with WAL
  cache_size: -64000, // 64 MB (negative = KiB)
} as const;

/** Required compile-time extensions */
export const REQUIRED_EXTENSIONS = ["json1"] as const;

/** Optional but recommended extensions */
export const RECOMMENDED_EXTENSIONS = ["fts5"] as const;

/** Banned filesystem types for primary DB files */
const BANNED_FS_PREFIXES = ["nfs", "smb", "cifs", "efs", "fuse.sshfs"];

// ── Error types ─────────────────────────────────────────────────────────────

export type StartupErrorKind =
  | "version_mismatch"
  | "missing_extension"
  | "filesystem_error"
  | "pragma_error";

export interface StartupError {
  kind: StartupErrorKind;
  message: string;
  found?: string;
  required?: string;
  path?: string;
  fix?: string;
}

// ── Version comparison ──────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Filesystem check ────────────────────────────────────────────────────────

function detectFilesystemType(dbPath: string): string | null {
  if (os.platform() !== "linux" && os.platform() !== "darwin") return null;

  try {
    const resolvedPath = path.resolve(dbPath);
    const { execSync } = require("child_process");

    if (os.platform() === "darwin") {
      const out = execSync(`df -T "${resolvedPath}" 2>/dev/null || df "${resolvedPath}"`, {
        encoding: "utf-8",
        timeout: 3000,
      });
      // macOS df output: second line has filesystem type info
      const lines = out.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        // Check mount source for network indicators
        const source = parts[0]?.toLowerCase() || "";
        if (source.includes("://") || source.includes("nfs") || source.includes("smb")) {
          return source;
        }
      }
    } else {
      // Linux: /proc/mounts
      const mounts = fs.readFileSync("/proc/mounts", "utf-8");
      let bestMatch = "";
      let bestFs = "unknown";
      for (const line of mounts.split("\n")) {
        const [, mountpoint, fstype] = line.split(/\s+/);
        if (mountpoint && resolvedPath.startsWith(mountpoint) && mountpoint.length > bestMatch.length) {
          bestMatch = mountpoint;
          bestFs = fstype || "unknown";
        }
      }
      return bestFs;
    }
  } catch {
    // Can't determine — allow through with warning
  }
  return null;
}

// ── Extension check ─────────────────────────────────────────────────────────

function checkExtension(db: DatabaseSync, ext: string): boolean {
  try {
    if (ext === "json1") {
      db.prepare("SELECT json('{}')").get();
      return true;
    }
    if (ext === "fts5") {
      // Try creating a temp FTS5 table
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_check USING fts5(x)");
      db.exec("DROP TABLE IF EXISTS _fts5_check");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Main validation ─────────────────────────────────────────────────────────

/**
 * Validate SQLite runtime environment. Returns array of errors (empty = OK).
 * Call this once at startup before serving requests.
 */
export function validateSQLiteEnvironment(db: DatabaseSync, dbPath: string): StartupError[] {
  const errors: StartupError[] = [];

  // 1. Version check
  const version = db.prepare("SELECT sqlite_version() as v").get() as { v: string };
  if (compareVersions(version.v, MIN_SQLITE_VERSION) < 0) {
    errors.push({
      kind: "version_mismatch",
      message: `SQLite version ${version.v} is below minimum ${MIN_SQLITE_VERSION}`,
      found: version.v,
      required: `>= ${MIN_SQLITE_VERSION}`,
      fix:
        "Ensure Node.js >= 22.16 is installed (node:sqlite is built-in)",
    });
  }

  // 2. Required extensions
  for (const ext of REQUIRED_EXTENSIONS) {
    if (!checkExtension(db, ext)) {
      errors.push({
        kind: "missing_extension",
        message: `Required SQLite extension '${ext}' is not available`,
        required: ext,
        fix: `Rebuild SQLite with -DSQLITE_ENABLE_${ext.toUpperCase()}=1, or use a system SQLite that includes it`,
      });
    }
  }

  // 3. Recommended extensions (warn only, don't block)
  for (const ext of RECOMMENDED_EXTENSIONS) {
    if (!checkExtension(db, ext)) {
      console.warn(`[startup] Recommended SQLite extension '${ext}' is not available. Full-text search will be disabled.`);
    }
  }

  // 4. Filesystem check
  const fsType = detectFilesystemType(dbPath);
  if (fsType) {
    const isBanned = BANNED_FS_PREFIXES.some((prefix) => fsType.toLowerCase().includes(prefix));
    if (isBanned) {
      errors.push({
        kind: "filesystem_error",
        message: `Database path '${dbPath}' is on a network filesystem (${fsType})`,
        path: dbPath,
        found: fsType,
        fix: "Move the database file to a local SSD. WAL mode requires local filesystem with reliable fsync.",
      });
    }
  }

  // 5. Apply PRAGMAs
  try {
    pragmaSet(db, `journal_mode = ${REQUIRED_PRAGMAS.journal_mode}`);
    pragmaSet(db, `foreign_keys = ${REQUIRED_PRAGMAS.foreign_keys}`);
    pragmaSet(db, `busy_timeout = ${REQUIRED_PRAGMAS.busy_timeout}`);
    pragmaSet(db, `synchronous = ${REQUIRED_PRAGMAS.synchronous}`);
    pragmaSet(db, `cache_size = ${REQUIRED_PRAGMAS.cache_size}`);

    // Verify journal_mode stuck — WAL preferred, DELETE acceptable (network FS),
    // memory/off are not safe for production.
    const jm = (pragmaGet(db, "journal_mode") as string).toLowerCase();
    const ACCEPTABLE_JOURNAL_MODES = new Set(["wal", "delete"]);
    if (!ACCEPTABLE_JOURNAL_MODES.has(jm)) {
      // WAL failed — try DELETE as fallback (works on network filesystems)
      pragmaSet(db, "journal_mode = DELETE");
      const jm2 = (pragmaGet(db, "journal_mode") as string).toLowerCase();
      if (!ACCEPTABLE_JOURNAL_MODES.has(jm2)) {
        errors.push({
          kind: "pragma_error",
          message: `Failed to set journal_mode (got '${jm2}', tried WAL then DELETE)`,
          found: jm2,
          required: "wal or delete",
          fix: "Ensure the database file is on a local filesystem and no other process holds an exclusive lock.",
        });
      } else {
        // DELETE mode needs synchronous=FULL for durability (WAL is safe with NORMAL)
        pragmaSet(db, "synchronous = FULL");
        console.warn(`[startup] WAL unavailable, using journal_mode=${jm2} with synchronous=FULL`);
      }
    }
  } catch (err: any) {
    errors.push({
      kind: "pragma_error",
      message: `Failed to apply required PRAGMAs: ${err.message}`,
      fix: "Check file permissions and ensure the database is not read-only.",
    });
  }

  return errors;
}

// ── WAL Backup/Restore contract ─────────────────────────────────────────────

/**
 * WAL-safe online backup using SQLite backup API.
 *
 * Contract:
 * - Use `backup(db, destPath)` from node:sqlite
 * - Checkpoint WAL before backup: PRAGMA wal_checkpoint(TRUNCATE)
 * - Checkpoint policy: auto-checkpoint at 1000 pages (SQLite default)
 * - Restore: stop app → replace DB file → delete WAL/SHM → restart
 * - RTO target: < 5 minutes for databases under 1 GB
 */
export async function backupDatabase(db: DatabaseSync, destPath: string): Promise<void> {
  // Checkpoint to flush WAL into main DB
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  // Use the backup API
  await sqliteBackup(db, destPath);
}

/**
 * Pre-restore checklist (to be run manually or by ops tooling):
 * 1. Stop all app processes
 * 2. Copy backup file to DB path
 * 3. Delete .db-wal and .db-shm files if present
 * 4. Restart app — startup checks will re-validate
 */

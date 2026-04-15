import type { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";

const MIN_SQLITE_VERSION = "3.35.0";

function parseVersion(v: string): number[] {
  return v.split(".").map(Number);
}

function versionGte(actual: string, required: string): boolean {
  const a = parseVersion(actual);
  const r = parseVersion(required);
  for (let i = 0; i < r.length; i++) {
    if ((a[i] ?? 0) > (r[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (r[i] ?? 0)) return false;
  }
  return true;
}

/**
 * Fails fast if the linked SQLite version is below 3.35.0.
 * Required for RETURNING clauses (3.35+) and UPSERT (3.24+).
 */
export function checkVersion(db: DatabaseSync): void {
  const row = db.prepare("SELECT sqlite_version() AS v").get() as {
    v: string;
  };
  const version = row.v;
  if (!versionGte(version, MIN_SQLITE_VERSION)) {
    throw new Error(
      `SQLite version ${version} is below minimum required ${MIN_SQLITE_VERSION}. ` +
        `RETURNING (3.35+) and UPSERT (3.24+) are required.`
    );
  }
}

/**
 * Fails fast if required extensions (JSON1, optionally FTS5) are missing.
 */
export function checkExtensions(
  db: DatabaseSync,
  opts?: { requireFts5?: boolean }
): void {
  // JSON1 check — json() is a core function when JSON1 is compiled in
  try {
    db.prepare("SELECT json('{}')").get();
  } catch {
    throw new Error(
      "Required SQLite extension JSON1 is not available. " +
        "Recompile SQLite with -DSQLITE_ENABLE_JSON1 or use a build that includes it."
    );
  }

  if (opts?.requireFts5) {
    try {
      db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(content)"
      );
      db.exec("DROP TABLE IF EXISTS _fts5_probe");
    } catch {
      throw new Error(
        "Required SQLite extension FTS5 is not available. " +
          "Recompile SQLite with -DSQLITE_ENABLE_FTS5."
      );
    }
  }
}

/**
 * Warn (or throw in strict mode) if the database file lives on a network filesystem.
 * Network filesystems (NFS, SMB/CIFS, EFS) do not support the locking semantics
 * required for WAL mode and can cause silent data corruption.
 */
export function checkFilesystem(
  dbPath: string,
  opts?: { strict?: boolean }
): void {
  // Only meaningful on Linux where /proc/mounts is available
  if (os.platform() !== "linux") return;

  try {
    const mounts = fs.readFileSync("/proc/mounts", "utf-8");
    const resolvedPath = fs.realpathSync(dbPath);
    const networkFsTypes = ["nfs", "nfs4", "cifs", "smb", "efs", "fuse.sshfs"];

    for (const line of mounts.split("\n")) {
      const parts = line.split(" ");
      if (parts.length < 3) continue;
      const mountPoint = parts[1];
      const fsType = parts[2];
      if (
        resolvedPath.startsWith(mountPoint) &&
        networkFsTypes.includes(fsType)
      ) {
        const msg =
          `Database path ${dbPath} is on a network filesystem (${fsType} at ${mountPoint}). ` +
          `WAL mode requires local storage with reliable fsync. Use a local SSD.`;
        if (opts?.strict) throw new Error(msg);
        console.warn(`[agx-db] WARNING: ${msg}`);
        return;
      }
    }
  } catch (err) {
    // If we can't read mounts and it's not our own error, skip silently
    if (err instanceof Error && err.message.startsWith("Database path")) {
      throw err;
    }
  }
}

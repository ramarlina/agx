import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor, backup: sqliteBackup } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaAll } from "@/lib/sqlite-compat";
import { DB_WAL_CHECKPOINT_INTERVAL_MS } from "@/lib/constants/timing";
import fs from "fs";
import path from "path";

export interface BackupOptions {
  /** Directory to store backup files */
  backupDir: string;
  /** Maximum number of backup files to retain (oldest pruned first) */
  maxBackups?: number;
}

export interface CheckpointPolicy {
  /** Passive checkpoint interval in milliseconds (default: 5 min) */
  passiveIntervalMs?: number;
  /** WAL size threshold in bytes to trigger RESTART checkpoint (default: 50 MB) */
  walSizeThreshold?: number;
}

const DEFAULT_PASSIVE_INTERVAL_MS = DB_WAL_CHECKPOINT_INTERVAL_MS;
const DEFAULT_WAL_SIZE_THRESHOLD = 50 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 10;

/**
 * Perform an online backup of a WAL-mode SQLite database.
 * Uses the SQLite Online Backup API via node:sqlite's `backup()`.
 * Produces a consistent snapshot without stopping writes.
 */
export async function backup(
  db: DatabaseSync,
  opts: BackupOptions
): Promise<string> {
  if (!fs.existsSync(opts.backupDir)) {
    fs.mkdirSync(opts.backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(opts.backupDir, `backup-${timestamp}.db`);

  await sqliteBackup(db, backupPath);

  // Prune old backups
  const maxBackups = opts.maxBackups ?? DEFAULT_MAX_BACKUPS;
  const files = fs
    .readdirSync(opts.backupDir)
    .filter((f) => f.startsWith("backup-") && f.endsWith(".db"))
    .sort();

  while (files.length > maxBackups) {
    const oldest = files.shift()!;
    fs.unlinkSync(path.join(opts.backupDir, oldest));
  }

  return backupPath;
}

/**
 * Restore a database from a backup file.
 *
 * Procedure (per §0.1.7):
 * 1. Caller must stop all processes accessing the database first.
 * 2. Removes existing .db, -wal, and -shm files.
 * 3. Copies backup into place.
 * 4. Opens DB and runs PRAGMA integrity_check.
 * 5. Returns the verified database instance.
 */
export function restore(
  backupPath: string,
  targetDbPath: string
): DatabaseSync {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  // Remove existing DB files
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = targetDbPath + suffix;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Copy backup into place
  fs.copyFileSync(backupPath, targetDbPath);

  // Open and verify integrity
  const db = new DatabaseSyncCtor(targetDbPath);
  const result = pragmaAll(db, "integrity_check") as { integrity_check: string }[];
  const status = result[0]?.integrity_check ?? "unknown";

  if (status !== "ok") {
    db.close();
    throw new Error(`Integrity check failed after restore: ${status}`);
  }

  return db;
}

/**
 * Run a checkpoint based on the configured policy.
 * - TRUNCATE: merges WAL into main DB and truncates WAL to 0 bytes (use on shutdown).
 * - PASSIVE: non-blocking best-effort (use periodically).
 * - RESTART: blocks new writers briefly, resets WAL (use when WAL exceeds size threshold).
 */
export function checkpoint(
  db: DatabaseSync,
  mode: "PASSIVE" | "RESTART" | "TRUNCATE"
): void {
  db.exec(`PRAGMA wal_checkpoint(${mode})`);
}

/**
 * Start periodic WAL checkpointing.
 * Returns a cleanup function to stop the interval.
 */
export function startCheckpointSchedule(
  db: DatabaseSync,
  dbPath: string,
  policy?: CheckpointPolicy
): () => void {
  const intervalMs =
    policy?.passiveIntervalMs ?? DEFAULT_PASSIVE_INTERVAL_MS;
  const walThreshold =
    policy?.walSizeThreshold ?? DEFAULT_WAL_SIZE_THRESHOLD;

  const timer = setInterval(() => {
    try {
      const walPath = dbPath + "-wal";
      if (fs.existsSync(walPath)) {
        const walSize = fs.statSync(walPath).size;
        if (walSize > walThreshold) {
          checkpoint(db, "RESTART");
          return;
        }
      }
      checkpoint(db, "PASSIVE");
    } catch {
      // Checkpoint errors are non-fatal; log and continue
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

/**
 * Perform a TRUNCATE checkpoint on graceful shutdown.
 */
export function shutdownCheckpoint(db: DatabaseSync): void {
  checkpoint(db, "TRUNCATE");
}

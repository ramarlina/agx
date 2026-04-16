import { NextResponse } from "next/server";
import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaSet, pragmaGet } from "@/lib/sqlite-compat";
import fs from "fs";
import os from "os";

const AGX_DATA_DIR = process.env.AGX_DATA_DIR || `${os.homedir()}/.agx`;
const SQLITE_QUEUE_PATH =
  process.env.SQLITE_QUEUE_PATH ||
  `${AGX_DATA_DIR}/agx-queue.db`;

type StatusLevel = "pass" | "fail" | "warn";

interface Check {
  label: string;
  value: string;
  status: StatusLevel;
}

const SYNC_MAP: Record<number, string> = {
  0: "OFF",
  1: "NORMAL",
  2: "FULL",
  3: "EXTRA",
};

function detectFilesystemType(dbPath: string): { fsType: string; status: StatusLevel } {
  // Note: os.platform() must be called at runtime, not hoisted to module scope,
  // to prevent Turbopack from evaluating it at build time and dead-code-eliminating
  // the Linux branch when building on macOS.
  let platform: string;
  try {
    platform = os.platform();
  } catch {
    return { fsType: "unknown", status: "warn" };
  }

  if (platform !== "linux") {
    return { fsType: `local (${platform})`, status: "pass" };
  }

  // Linux: check /proc/mounts for network filesystems
  let mounts = "";
  try { mounts = fs.readFileSync("/proc/mounts", "utf-8"); } catch { /* */ }
  if (!mounts) return { fsType: "unknown", status: "warn" };

  let resolvedPath = dbPath;
  try { resolvedPath = fs.realpathSync(dbPath); } catch { /* */ }

  const networkFsTypes = ["nfs", "nfs4", "cifs", "smb", "efs", "fuse.sshfs"];
  const lines = mounts.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(" ");
    if (parts.length < 3) continue;
    if (resolvedPath.startsWith(parts[1]) && networkFsTypes.includes(parts[2])) {
      return { fsType: `${parts[2]} (network)`, status: "fail" };
    }
  }
  return { fsType: "local", status: "pass" };
}

function getBackupStatus(dbPath: string): { lastBackup: string | null; walSizeBytes: number | null } {
  const backupDir = `${dbPath}-backups`;
  let lastBackup: string | null = null;
  if (fs.existsSync(backupDir)) {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".db"))
      .sort();
    if (files.length > 0) {
      const latest = files[files.length - 1];
      const stat = fs.statSync(`${backupDir}/${latest}`);
      lastBackup = stat.mtime.toISOString();
    }
  }

  let walSizeBytes: number | null = null;
  const walPath = `${dbPath}-wal`;
  if (fs.existsSync(walPath)) {
    walSizeBytes = fs.statSync(walPath).size;
  }

  return { lastBackup, walSizeBytes };
}

// GET /api/system/db-status
export async function GET() {
  const checks: Check[] = [];
  let version = "unknown";
  let backupInfo = { lastBackup: null as string | null, walSizeBytes: null as number | null };

  let db: DatabaseSync | null = null;
  try {
    // Open the queue DB — create if missing (in-memory can't use WAL/DELETE)
    const dbDir = SQLITE_QUEUE_PATH.replace(/\/[^/]+$/, "");
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    db = new DatabaseSyncCtor(SQLITE_QUEUE_PATH);

    // Apply journal_mode: try WAL first, fall back to DELETE
    pragmaSet(db, "journal_mode = WAL");
    let journalMode = String(pragmaGet(db, "journal_mode")).toLowerCase();
    if (journalMode !== "wal") {
      pragmaSet(db, "journal_mode = DELETE");
      journalMode = String(pragmaGet(db, "journal_mode")).toLowerCase();
    }

    // Version
    const row = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
    version = row.v;
    const vParts = version.split(".").map(Number);
    const meetsMin = vParts[0] > 3 || (vParts[0] === 3 && vParts[1] >= 35);
    checks.push({
      label: "SQLite Version",
      value: version,
      status: meetsMin ? "pass" : "fail",
    });

    // PRAGMAs
    checks.push({
      label: "journal_mode",
      value: journalMode,
      status: journalMode === "wal" || journalMode === "delete" ? "pass" : "fail",
    });

    const fk = Number(pragmaGet(db, "foreign_keys"));
    checks.push({
      label: "foreign_keys",
      value: fk ? "ON" : "OFF",
      status: fk ? "pass" : "fail",
    });

    const busyTimeout = Number(pragmaGet(db, "busy_timeout"));
    checks.push({
      label: "busy_timeout",
      value: `${busyTimeout} ms`,
      status: busyTimeout > 0 ? "pass" : "warn",
    });

    const syncLevel = Number(pragmaGet(db, "synchronous"));
    checks.push({
      label: "synchronous",
      value: SYNC_MAP[syncLevel] ?? String(syncLevel),
      status: syncLevel >= 1 ? "pass" : "warn",
    });

    const cacheSize = Number(pragmaGet(db, "cache_size"));
    checks.push({
      label: "cache_size",
      value: cacheSize < 0 ? `${Math.abs(cacheSize)} KiB` : `${cacheSize} pages`,
      status: "pass",
    });

    // JSON1
    let json1 = false;
    try {
      db.prepare("SELECT json('{}')").get();
      json1 = true;
    } catch {}
    checks.push({
      label: "JSON1 Extension",
      value: json1 ? "available" : "missing",
      status: json1 ? "pass" : "fail",
    });

    // FTS5
    let fts5 = false;
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(content)");
      db.exec("DROP TABLE IF EXISTS _fts5_probe");
      fts5 = true;
    } catch {}
    checks.push({
      label: "FTS5 Extension",
      value: fts5 ? "available" : "not available",
      status: fts5 ? "pass" : "warn",
    });

    // Filesystem
    try {
      const fsInfo = detectFilesystemType(SQLITE_QUEUE_PATH);
      checks.push({
        label: "Filesystem",
        value: fsInfo?.fsType ?? "unknown",
        status: fsInfo?.status ?? "warn",
      });
      backupInfo = getBackupStatus(SQLITE_QUEUE_PATH);
    } catch {
      checks.push({ label: "Filesystem", value: "unknown", status: "warn" });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to query SQLite status", checks },
      { status: 500 }
    );
  } finally {
    db?.close();
  }

  return NextResponse.json({
    version,
    checks,
    backup: {
      lastBackup: backupInfo.lastBackup,
      walSizeBytes: backupInfo.walSizeBytes,
    },
  });
}

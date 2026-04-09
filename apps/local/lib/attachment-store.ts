import { DatabaseSync } from "node:sqlite";
import { pragmaSet } from "./sqlite-compat";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { Attachment } from "./types";

const HISTORY_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(HISTORY_DIR, "history.sqlite");
const UPLOADS_DIR = path.join(HISTORY_DIR, "uploads");

function getDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  return db;
}

export function initAttachmentsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      filename TEXT NOT NULL,
      disk_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
  `);
  // Migration: add disk_name column if missing
  const cols = db.prepare("PRAGMA table_info(attachments)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "disk_name")) {
    db.exec(`ALTER TABLE attachments ADD COLUMN disk_name TEXT NOT NULL DEFAULT ''`);
    // Backfill: derive disk_name from id + filename extension
    const rows = db.prepare("SELECT id, filename FROM attachments WHERE disk_name = ''").all() as Array<{ id: string; filename: string }>;
    const stmt = db.prepare("UPDATE attachments SET disk_name = ? WHERE id = ?");
    for (const r of rows) {
      const ext = r.filename.includes(".") ? "." + r.filename.split(".").pop()!.toLowerCase() : "";
      stmt.run(r.id + ext, r.id);
    }
  }
}

export async function createAttachment(meta: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
}): Promise<Attachment> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  // Preserve original extension so agents/tools can recognize file types
  const ext = meta.filename.includes(".") ? "." + meta.filename.split(".").pop()!.toLowerCase() : "";
  const diskName = meta.id + ext;
  const filePath = path.join(UPLOADS_DIR, diskName);
  await fs.writeFile(filePath, meta.data);

  const db = getDb();
  try {
    initAttachmentsTable(db);
    db.prepare(
      `INSERT INTO attachments (id, disk_name, filename, mime_type, size, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'uploaded', ?)`
    ).run(meta.id, diskName, meta.filename, meta.mimeType, meta.size, Date.now());
  } finally {
    db.close();
  }

  return {
    id: meta.id,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    status: "uploaded",
    url: `/api/attachments/${meta.id}`,
  };
}

export interface AttachmentWithPath extends Attachment {
  diskPath: string;
}

export async function finalizeAttachments(messageId: string, attachmentIds: string[]): Promise<AttachmentWithPath[]> {
  if (attachmentIds.length === 0) return [];

  const db = getDb();
  try {
    initAttachmentsTable(db);
    const placeholders = attachmentIds.map(() => "?").join(", ");
    db.prepare(
      `UPDATE attachments SET message_id = ? WHERE id IN (${placeholders})`
    ).run(messageId, ...attachmentIds);

    const rows = db.prepare(
      `SELECT id, disk_name, filename, mime_type, size, status FROM attachments WHERE id IN (${placeholders})`
    ).all(...attachmentIds) as Array<{
      id: string;
      disk_name: string;
      filename: string;
      mime_type: string;
      size: number;
      status: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mime_type,
      size: r.size,
      status: r.status as Attachment["status"],
      url: `/api/attachments/${r.id}`,
      diskPath: path.join(UPLOADS_DIR, r.disk_name || r.id),
    }));
  } finally {
    db.close();
  }
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const filePath = path.join(UPLOADS_DIR, id);
  try { await fs.unlink(filePath); } catch { /* ignore */ }

  const db = getDb();
  try {
    initAttachmentsTable(db);
    const result = db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
    return result.changes > 0;
  } finally {
    db.close();
  }
}

export function getAttachmentPath(id: string): string {
  // Caller should prefer getAttachmentMeta().diskPath for accuracy,
  // but this works as fallback for simple id-only lookups.
  return path.join(UPLOADS_DIR, id);
}

export async function getAttachmentMeta(id: string): Promise<{ filename: string; mimeType: string; size: number; diskPath: string } | null> {
  const db = getDb();
  try {
    initAttachmentsTable(db);
    const row = db.prepare(
      `SELECT filename, disk_name, mime_type, size FROM attachments WHERE id = ?`
    ).get(id) as { filename: string; disk_name: string; mime_type: string; size: number } | undefined;
    if (!row) return null;
    const diskName = row.disk_name || id;
    return { filename: row.filename, mimeType: row.mime_type, size: row.size, diskPath: path.join(UPLOADS_DIR, diskName) };
  } finally {
    db.close();
  }
}

export async function getAttachmentsForMessages(messageIds: string[]): Promise<Map<string, Attachment[]>> {
  if (messageIds.length === 0) return new Map();

  const db = getDb();
  try {
    initAttachmentsTable(db);
    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT id, message_id, filename, mime_type, size, status
       FROM attachments
       WHERE message_id IN (${placeholders})`
    ).all(...messageIds) as Array<{
      id: string;
      message_id: string;
      filename: string;
      mime_type: string;
      size: number;
      status: string;
    }>;

    const map = new Map<string, Attachment[]>();
    for (const r of rows) {
      const att: Attachment = {
        id: r.id,
        filename: r.filename,
        mimeType: r.mime_type,
        size: r.size,
        status: r.status as Attachment["status"],
        url: `/api/attachments/${r.id}`,
      };
      const list = map.get(r.message_id) || [];
      list.push(att);
      map.set(r.message_id, list);
    }
    return map;
  } finally {
    db.close();
  }
}

// Garbage collect orphaned attachments (no message_id) older than 24h
export async function gcOrphanedAttachments(): Promise<number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const db = getDb();
  try {
    initAttachmentsTable(db);
    const orphans = db.prepare(
      `SELECT id, disk_name FROM attachments WHERE message_id IS NULL AND created_at < ?`
    ).all(cutoff) as Array<{ id: string; disk_name: string }>;

    for (const { id, disk_name } of orphans) {
      const filePath = path.join(UPLOADS_DIR, disk_name || id);
      try { await fs.unlink(filePath); } catch { /* ignore */ }
    }

    if (orphans.length > 0) {
      const placeholders = orphans.map(() => "?").join(", ");
      db.prepare(`DELETE FROM attachments WHERE id IN (${placeholders})`).run(
        ...orphans.map((o) => o.id)
      );
    }

    return orphans.length;
  } finally {
    db.close();
  }
}

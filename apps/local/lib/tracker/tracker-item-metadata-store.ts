import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pragmaSet, transaction } from "../sqlite-compat";

const TRACKER_DIR =
  process.env.AGX_TRACKER_DIR?.trim() ||
  path.join(process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"), "tracker");
const DB_PATH = path.join(TRACKER_DIR, "items.sqlite");

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21] as const;
export type FibonacciEstimate = (typeof FIBONACCI)[number];
export const FIBONACCI_VALUES: readonly number[] = FIBONACCI;

export interface ItemMetadata {
  labels: string[];
  estimate: number | null;
}

export interface LabelDefinition {
  id: string;
  name: string;
  color: string | null;
}

const DEFAULT_TRACKER = "agx";

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracker_item_metadata (
      issue_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      tracker TEXT NOT NULL DEFAULT '${DEFAULT_TRACKER}',
      labels_json TEXT NOT NULL DEFAULT '[]',
      estimate INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (issue_id, project_id, tracker)
    );
    CREATE TABLE IF NOT EXISTS tracker_label_definitions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      tracker TEXT NOT NULL DEFAULT '${DEFAULT_TRACKER}',
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, tracker, name)
    );
  `);

  // Backfill: older DBs may have these tables without a tracker column.
  if (!hasColumn(db, "tracker_item_metadata", "tracker")) {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE tracker_item_metadata__new (
          issue_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          tracker TEXT NOT NULL DEFAULT '${DEFAULT_TRACKER}',
          labels_json TEXT NOT NULL DEFAULT '[]',
          estimate INTEGER,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (issue_id, project_id, tracker)
        );
        INSERT INTO tracker_item_metadata__new (issue_id, project_id, tracker, labels_json, estimate, updated_at)
          SELECT issue_id, project_id, '${DEFAULT_TRACKER}', labels_json, estimate, updated_at FROM tracker_item_metadata;
        DROP TABLE tracker_item_metadata;
        ALTER TABLE tracker_item_metadata__new RENAME TO tracker_item_metadata;
      `);
    });
  }

  if (!hasColumn(db, "tracker_label_definitions", "tracker")) {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE tracker_label_definitions__new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          tracker TEXT NOT NULL DEFAULT '${DEFAULT_TRACKER}',
          name TEXT NOT NULL,
          color TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, tracker, name)
        );
        INSERT INTO tracker_label_definitions__new (id, project_id, tracker, name, color, created_at)
          SELECT id, project_id, '${DEFAULT_TRACKER}', name, color, created_at FROM tracker_label_definitions;
        DROP TABLE tracker_label_definitions;
        ALTER TABLE tracker_label_definitions__new RENAME TO tracker_label_definitions;
      `);
    });
  }
}

async function withDb<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(TRACKER_DIR, { recursive: true });
  const db = new (process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite")).DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    migrate(db);
    return run(db);
  } finally {
    db.close();
  }
}

function parseLabels(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((l: unknown) => typeof l === "string" && l.trim()) : [];
  } catch {
    return [];
  }
}

export async function getItemMetadata(projectId: string, tracker: string, issueId: string): Promise<ItemMetadata> {
  return withDb((db) => {
    const row = db.prepare(
      "SELECT labels_json, estimate FROM tracker_item_metadata WHERE project_id = ? AND tracker = ? AND issue_id = ?"
    ).get(projectId, tracker, issueId) as { labels_json: string; estimate: number | null } | undefined;
    if (!row) return { labels: [], estimate: null };
    return { labels: parseLabels(row.labels_json), estimate: row.estimate };
  });
}

export async function setItemMetadata(
  projectId: string,
  tracker: string,
  issueId: string,
  update: { labels?: string[]; estimate?: number | null }
): Promise<ItemMetadata> {
  return withDb((db) => {
    const existing = db.prepare(
      "SELECT labels_json, estimate FROM tracker_item_metadata WHERE project_id = ? AND tracker = ? AND issue_id = ?"
    ).get(projectId, tracker, issueId) as { labels_json: string; estimate: number | null } | undefined;

    const labels = update.labels ?? parseLabels(existing?.labels_json ?? null);
    const estimate = update.estimate !== undefined ? update.estimate : (existing?.estimate ?? null);

    db.prepare(`
      INSERT INTO tracker_item_metadata (issue_id, project_id, tracker, labels_json, estimate, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(issue_id, project_id, tracker) DO UPDATE SET
        labels_json = excluded.labels_json,
        estimate = excluded.estimate,
        updated_at = excluded.updated_at
    `).run(issueId, projectId, tracker, JSON.stringify(labels), estimate);

    return { labels, estimate };
  });
}

export async function bulkGetItemMetadata(
  projectId: string,
  tracker: string,
  issueIds: string[]
): Promise<Map<string, ItemMetadata>> {
  if (issueIds.length === 0) return new Map();
  return withDb((db) => {
    const placeholders = issueIds.map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT issue_id, labels_json, estimate FROM tracker_item_metadata
       WHERE project_id = ? AND tracker = ? AND issue_id IN (${placeholders})`
    ).all(projectId, tracker, ...issueIds) as Array<{ issue_id: string; labels_json: string; estimate: number | null }>;

    const result = new Map<string, ItemMetadata>();
    for (const row of rows) {
      result.set(row.issue_id, { labels: parseLabels(row.labels_json), estimate: row.estimate });
    }
    return result;
  });
}

export async function bulkSetEstimate(
  projectId: string,
  tracker: string,
  issueIds: string[],
  estimate: number | null
): Promise<void> {
  if (issueIds.length === 0) return;
  return withDb((db) => {
    transaction(db, () => {
      const stmt = db.prepare(`
        INSERT INTO tracker_item_metadata (issue_id, project_id, tracker, estimate, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(issue_id, project_id, tracker) DO UPDATE SET
          estimate = excluded.estimate,
          updated_at = excluded.updated_at
      `);
      for (const issueId of issueIds) {
        stmt.run(issueId, projectId, tracker, estimate);
      }
    });
  });
}

export async function bulkAddLabels(
  projectId: string,
  tracker: string,
  issueIds: string[],
  labelsToAdd: string[]
): Promise<void> {
  if (issueIds.length === 0 || labelsToAdd.length === 0) return;
  return withDb((db) => {
    transaction(db, () => {
      for (const issueId of issueIds) {
        const row = db.prepare(
          "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ? AND tracker = ? AND issue_id = ?"
        ).get(projectId, tracker, issueId) as { labels_json: string } | undefined;

        const existing = parseLabels(row?.labels_json ?? null);
        const merged = Array.from(new Set([...existing, ...labelsToAdd]));

        db.prepare(`
          INSERT INTO tracker_item_metadata (issue_id, project_id, tracker, labels_json, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(issue_id, project_id, tracker) DO UPDATE SET
            labels_json = excluded.labels_json,
            updated_at = excluded.updated_at
        `).run(issueId, projectId, tracker, JSON.stringify(merged));
      }
    });
  });
}

export async function bulkRemoveLabel(
  projectId: string,
  tracker: string,
  issueIds: string[],
  label: string
): Promise<void> {
  if (issueIds.length === 0 || !label.trim()) return;
  return withDb((db) => {
    transaction(db, () => {
      for (const issueId of issueIds) {
        const row = db.prepare(
          "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ? AND tracker = ? AND issue_id = ?"
        ).get(projectId, tracker, issueId) as { labels_json: string } | undefined;

        if (!row) continue;
        const existing = parseLabels(row.labels_json);
        const filtered = existing.filter((l) => l !== label);

        db.prepare(
          "UPDATE tracker_item_metadata SET labels_json = ?, updated_at = datetime('now') WHERE project_id = ? AND tracker = ? AND issue_id = ?"
        ).run(JSON.stringify(filtered), projectId, tracker, issueId);
      }
    });
  });
}

export async function listLabelDefinitions(projectId: string, tracker: string): Promise<LabelDefinition[]> {
  return withDb((db) => {
    const rows = db.prepare(
      "SELECT id, name, color FROM tracker_label_definitions WHERE project_id = ? AND tracker = ? ORDER BY name ASC"
    ).all(projectId, tracker) as Array<{ id: string; name: string; color: string | null }>;
    return rows;
  });
}

export async function createLabelDefinition(
  projectId: string,
  tracker: string,
  name: string,
  color?: string | null
): Promise<LabelDefinition> {
  const id = globalThis.crypto?.randomUUID?.() ?? `label-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Label name is required");

  return withDb((db) => {
    db.prepare(
      "INSERT INTO tracker_label_definitions (id, project_id, tracker, name, color) VALUES (?, ?, ?, ?, ?)"
    ).run(id, projectId, tracker, trimmedName, color?.trim() || null);
    return { id, name: trimmedName, color: color?.trim() || null };
  });
}

export async function deleteLabelDefinition(projectId: string, tracker: string, id: string): Promise<void> {
  return withDb((db) => {
    db.prepare(
      "DELETE FROM tracker_label_definitions WHERE id = ? AND project_id = ? AND tracker = ?"
    ).run(id, projectId, tracker);
  });
}

export async function listAllLabels(projectId: string, tracker: string): Promise<Array<{ name: string; color: string | null; defined: boolean }>> {
  return withDb((db) => {
    const definitions = db.prepare(
      "SELECT name, color FROM tracker_label_definitions WHERE project_id = ? AND tracker = ? ORDER BY name ASC"
    ).all(projectId, tracker) as Array<{ name: string; color: string | null }>;

    const metadataRows = db.prepare(
      "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ? AND tracker = ?"
    ).all(projectId, tracker) as Array<{ labels_json: string }>;

    const definedNames = new Set(definitions.map((d) => d.name));
    const allUsed = new Set<string>();
    for (const row of metadataRows) {
      for (const label of parseLabels(row.labels_json)) {
        allUsed.add(label);
      }
    }

    const result: Array<{ name: string; color: string | null; defined: boolean }> = [];
    for (const def of definitions) {
      result.push({ name: def.name, color: def.color, defined: true });
    }
    for (const name of allUsed) {
      if (!definedNames.has(name)) {
        result.push({ name, color: null, defined: false });
      }
    }
    return result;
  });
}

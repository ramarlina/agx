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

async function withDb<T>(run: (db: DatabaseSync) => T): Promise<T> {
  await fs.mkdir(TRACKER_DIR, { recursive: true });
  const db = new (process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite")).DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tracker_item_metadata (
        issue_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        labels_json TEXT NOT NULL DEFAULT '[]',
        estimate INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (issue_id, project_id)
      );
      CREATE TABLE IF NOT EXISTS tracker_label_definitions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, name)
      );
    `);
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

export async function getItemMetadata(projectId: string, issueId: string): Promise<ItemMetadata> {
  return withDb((db) => {
    const row = db.prepare(
      "SELECT labels_json, estimate FROM tracker_item_metadata WHERE project_id = ? AND issue_id = ?"
    ).get(projectId, issueId) as { labels_json: string; estimate: number | null } | undefined;
    if (!row) return { labels: [], estimate: null };
    return { labels: parseLabels(row.labels_json), estimate: row.estimate };
  });
}

export async function setItemMetadata(
  projectId: string,
  issueId: string,
  update: { labels?: string[]; estimate?: number | null }
): Promise<ItemMetadata> {
  return withDb((db) => {
    const existing = db.prepare(
      "SELECT labels_json, estimate FROM tracker_item_metadata WHERE project_id = ? AND issue_id = ?"
    ).get(projectId, issueId) as { labels_json: string; estimate: number | null } | undefined;

    const labels = update.labels ?? parseLabels(existing?.labels_json ?? null);
    const estimate = update.estimate !== undefined ? update.estimate : (existing?.estimate ?? null);

    db.prepare(`
      INSERT INTO tracker_item_metadata (issue_id, project_id, labels_json, estimate, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(issue_id, project_id) DO UPDATE SET
        labels_json = excluded.labels_json,
        estimate = excluded.estimate,
        updated_at = excluded.updated_at
    `).run(issueId, projectId, JSON.stringify(labels), estimate);

    return { labels, estimate };
  });
}

export async function bulkGetItemMetadata(
  projectId: string,
  issueIds: string[]
): Promise<Map<string, ItemMetadata>> {
  if (issueIds.length === 0) return new Map();
  return withDb((db) => {
    const placeholders = issueIds.map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT issue_id, labels_json, estimate FROM tracker_item_metadata
       WHERE project_id = ? AND issue_id IN (${placeholders})`
    ).all(projectId, ...issueIds) as Array<{ issue_id: string; labels_json: string; estimate: number | null }>;

    const result = new Map<string, ItemMetadata>();
    for (const row of rows) {
      result.set(row.issue_id, { labels: parseLabels(row.labels_json), estimate: row.estimate });
    }
    return result;
  });
}

export async function bulkSetEstimate(
  projectId: string,
  issueIds: string[],
  estimate: number | null
): Promise<void> {
  if (issueIds.length === 0) return;
  return withDb((db) => {
    transaction(db, () => {
      const stmt = db.prepare(`
        INSERT INTO tracker_item_metadata (issue_id, project_id, estimate, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(issue_id, project_id) DO UPDATE SET
          estimate = excluded.estimate,
          updated_at = excluded.updated_at
      `);
      for (const issueId of issueIds) {
        stmt.run(issueId, projectId, estimate);
      }
    });
  });
}

export async function bulkAddLabels(
  projectId: string,
  issueIds: string[],
  labelsToAdd: string[]
): Promise<void> {
  if (issueIds.length === 0 || labelsToAdd.length === 0) return;
  return withDb((db) => {
    transaction(db, () => {
      for (const issueId of issueIds) {
        const row = db.prepare(
          "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ? AND issue_id = ?"
        ).get(projectId, issueId) as { labels_json: string } | undefined;

        const existing = parseLabels(row?.labels_json ?? null);
        const merged = Array.from(new Set([...existing, ...labelsToAdd]));

        db.prepare(`
          INSERT INTO tracker_item_metadata (issue_id, project_id, labels_json, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(issue_id, project_id) DO UPDATE SET
            labels_json = excluded.labels_json,
            updated_at = excluded.updated_at
        `).run(issueId, projectId, JSON.stringify(merged));
      }
    });
  });
}

export async function bulkRemoveLabel(
  projectId: string,
  issueIds: string[],
  label: string
): Promise<void> {
  if (issueIds.length === 0 || !label.trim()) return;
  return withDb((db) => {
    transaction(db, () => {
      for (const issueId of issueIds) {
        const row = db.prepare(
          "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ? AND issue_id = ?"
        ).get(projectId, issueId) as { labels_json: string } | undefined;

        if (!row) continue;
        const existing = parseLabels(row.labels_json);
        const filtered = existing.filter((l) => l !== label);

        db.prepare(
          "UPDATE tracker_item_metadata SET labels_json = ?, updated_at = datetime('now') WHERE project_id = ? AND issue_id = ?"
        ).run(JSON.stringify(filtered), projectId, issueId);
      }
    });
  });
}

export async function listLabelDefinitions(projectId: string): Promise<LabelDefinition[]> {
  return withDb((db) => {
    const rows = db.prepare(
      "SELECT id, name, color FROM tracker_label_definitions WHERE project_id = ? ORDER BY name ASC"
    ).all(projectId) as Array<{ id: string; name: string; color: string | null }>;
    return rows;
  });
}

export async function createLabelDefinition(
  projectId: string,
  name: string,
  color?: string | null
): Promise<LabelDefinition> {
  const id = globalThis.crypto?.randomUUID?.() ?? `label-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Label name is required");

  return withDb((db) => {
    db.prepare(
      "INSERT INTO tracker_label_definitions (id, project_id, name, color) VALUES (?, ?, ?, ?)"
    ).run(id, projectId, trimmedName, color?.trim() || null);
    return { id, name: trimmedName, color: color?.trim() || null };
  });
}

export async function deleteLabelDefinition(projectId: string, id: string): Promise<void> {
  return withDb((db) => {
    db.prepare(
      "DELETE FROM tracker_label_definitions WHERE id = ? AND project_id = ?"
    ).run(id, projectId);
  });
}

export async function listAllLabels(projectId: string): Promise<Array<{ name: string; color: string | null; defined: boolean }>> {
  return withDb((db) => {
    const definitions = db.prepare(
      "SELECT name, color FROM tracker_label_definitions WHERE project_id = ? ORDER BY name ASC"
    ).all(projectId) as Array<{ name: string; color: string | null }>;

    const metadataRows = db.prepare(
      "SELECT labels_json FROM tracker_item_metadata WHERE project_id = ?"
    ).all(projectId) as Array<{ labels_json: string }>;

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

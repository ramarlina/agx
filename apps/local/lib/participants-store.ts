import { DatabaseSync } from "node:sqlite";
import { pragmaAll, pragmaSet, transaction, transactionFn } from "./sqlite-compat";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import type { Participant } from "./types";

const STORE_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(STORE_DIR, "history.sqlite");
const AGENTS_DIR =
  process.env.AGX_AGENTS_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "agents");

function slugifyParticipantId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function nextUniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function migrateAgentDirectory(oldId: string, newId: string, displayName: string): void {
  if (!oldId || !newId || oldId === newId) return;
  const oldDir = path.join(AGENTS_DIR, oldId);
  const newDir = path.join(AGENTS_DIR, newId);
  if (!existsSync(oldDir) || existsSync(newDir)) return;
  mkdirSync(AGENTS_DIR, { recursive: true });
  renameSync(oldDir, newDir);

  const identityPath = path.join(newDir, "identity.json");
  if (!existsSync(identityPath)) return;

  try {
    const parsed = JSON.parse(readFileSync(identityPath, "utf8")) as { name?: unknown };
    const updated = {
      ...parsed,
      name: typeof displayName === "string" && displayName.trim() ? displayName.trim() : newId,
    };
    writeFileSync(identityPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  } catch {
    // keep existing identity if malformed
  }
}

function migrateLegacyParticipantIds(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT id, name, provider FROM participants")
    .all() as Array<{ id: string; name: string; provider: string }>;
  if (rows.length === 0) return;

  const used = new Set(rows.map((row) => row.id));
  const canonicalIdByOriginalId = new Map(rows.map((row) => [row.id, row.id]));
  const renames: Array<{ from: string; to: string; name: string }> = [];

  for (const row of rows) {
    const desiredBase = slugifyParticipantId(row.name || "");
    if (!desiredBase) continue;
    if (row.id === desiredBase) continue;
    // Only migrate legacy provider-based IDs (e.g. claude -> jane).
    if (row.id !== row.provider) continue;

    used.delete(row.id);
    const desired = nextUniqueId(desiredBase, used);
    used.add(desired);
    canonicalIdByOriginalId.set(row.id, desired);
    renames.push({ from: row.id, to: desired, name: row.name });
  }

  const canonicalRows = rows.map((row) => ({
    id: canonicalIdByOriginalId.get(row.id) || row.id,
    provider: row.provider,
  }));

  const canonicalParticipantIds = new Set(canonicalRows.map((row) => row.id));
  const providerOwners = new Map<string, Set<string>>();
  for (const row of canonicalRows) {
    const provider = row.provider.trim();
    if (!provider) continue;
    const owners = providerOwners.get(provider) || new Set<string>();
    owners.add(row.id);
    providerOwners.set(provider, owners);
  }

  // Some histories still store provider IDs (e.g. "claude", "ollama") after
  // IDs have already migrated to name-slugs. Canonicalize those references
  // when the mapping is unambiguous.
  const aliasFixes: Array<{ from: string; to: string }> = [];
  for (const [providerId, owners] of providerOwners) {
    if (owners.size !== 1) continue;
    const [ownerId] = Array.from(owners);
    if (!ownerId || providerId === ownerId) continue;
    if (canonicalParticipantIds.has(providerId)) continue;
    aliasFixes.push({ from: providerId, to: ownerId });
  }

  if (renames.length === 0 && aliasFixes.length === 0) return;

  const referenceFixBySource = new Map<string, string>();
  for (const rename of renames) {
    referenceFixBySource.set(rename.from, rename.to);
  }
  for (const alias of aliasFixes) {
    referenceFixBySource.set(alias.from, alias.to);
  }
  const referenceFixes = Array.from(referenceFixBySource.entries()).map(([from, to]) => ({ from, to }));

  const tableNames = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
  );

  const migrateTxn = transactionFn(db, (participantOps: Array<{ from: string; to: string }>, referenceOps: Array<{ from: string; to: string }>) => {
    const updateParticipant = db.prepare("UPDATE participants SET id = ? WHERE id = ?");
    const updateMessages = tableNames.has("messages")
      ? db.prepare("UPDATE messages SET participant_id = ? WHERE participant_id = ?")
      : null;
    const updateAgentProcesses = tableNames.has("agent_processes")
      ? db.prepare("UPDATE agent_processes SET agent_id = ? WHERE agent_id = ?")
      : null;
    const updateReactions = tableNames.has("message_reactions")
      ? db.prepare("UPDATE message_reactions SET participant_id = ? WHERE participant_id = ?")
      : null;

    for (const op of participantOps) {
      updateParticipant.run(op.to, op.from);
    }

    for (const op of referenceOps) {
      updateMessages?.run(op.to, op.from);
      updateAgentProcesses?.run(op.to, op.from);
      updateReactions?.run(op.to, op.from);
    }
  });

  migrateTxn(
    renames.map((rename) => ({ from: rename.from, to: rename.to })),
    referenceFixes
  );

  for (const rename of renames) {
    migrateAgentDirectory(rename.from, rename.to, rename.name);
  }
}

function getDb(): DatabaseSync {
  mkdirSync(STORE_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  pragmaSet(db, "journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      identity TEXT,
      identity_file TEXT,
      skills_json TEXT,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  const columns = pragmaAll(db, "table_info(participants)") as Array<{ name: string }>;
  // Migration: rename persona -> identity, persona_file -> identity_file
  if (columns.some((column) => column.name === "persona")) {
    db.exec("ALTER TABLE participants RENAME COLUMN persona TO identity");
    db.exec("ALTER TABLE participants RENAME COLUMN persona_file TO identity_file");
  }
  if (!columns.some((column) => column.name === "identity_file") && !columns.some((column) => column.name === "persona_file")) {
    db.exec("ALTER TABLE participants ADD COLUMN identity_file TEXT");
  }
  if (!columns.some((column) => column.name === "skills_json")) {
    db.exec("ALTER TABLE participants ADD COLUMN skills_json TEXT");
  }
  if (!columns.some((column) => column.name === "variables_json")) {
    db.exec("ALTER TABLE participants ADD COLUMN variables_json TEXT");
  }
  if (!columns.some((column) => column.name === "sort_order")) {
    db.exec("ALTER TABLE participants ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    // Initialize sort_order based on rowid so existing agents keep their current order
    db.exec("UPDATE participants SET sort_order = rowid");
  }
  migrateLegacyParticipantIds(db);

  return db;
}

// No seed logic here — the agx CLI onboarding (`agx init`) creates the
// default "Sage" participant directly in the SQLite DB.

export function loadParticipants(): Participant[] {
  const db = getDb();
  try {
    const rows = db
      .prepare("SELECT id, name, provider, model, identity, identity_file, skills_json, variables_json, color, sort_order FROM participants ORDER BY sort_order ASC, rowid ASC")
      .all() as Array<{
      id: string;
      name: string;
      provider: Participant["provider"];
      model: string | null;
      identity: string | null;
      identity_file: string | null;
      skills_json: string | null;
      variables_json: string | null;
      color: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      model: r.model,
      color: r.color,
      ...(r.identity ? { identity: r.identity } : {}),
      ...(r.identity_file ? { identityFile: r.identity_file } : {}),
      ...(r.variables_json
        ? (() => {
            try {
              const parsed = JSON.parse(r.variables_json);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return { variables: parsed as Record<string, string> };
              }
              return {};
            } catch {
              return {};
            }
          })()
        : {}),
      ...(r.skills_json
        ? {
          skills: (() => {
            try {
              const parsed = JSON.parse(r.skills_json);
              if (!Array.isArray(parsed)) return [];
              return parsed.map((item: unknown) =>
                typeof item === "string"
                  ? { file: item, condition: "" }
                  : (item as { file: string; condition: string })
              );
            } catch {
              return [];
            }
          })(),
        }
        : {}),
    }));
  } finally {
    db.close();
  }
}

export function addParticipant(p: Participant): void {
  const db = getDb();
  try {
    db.prepare(
      "INSERT OR REPLACE INTO participants (id, name, provider, model, identity, identity_file, skills_json, variables_json, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      p.id,
      p.name,
      p.provider,
      p.model,
      p.identity ?? null,
      p.identityFile ?? null,
      p.skills && p.skills.length > 0 ? JSON.stringify(p.skills) : null,
      p.variables && Object.keys(p.variables).length > 0 ? JSON.stringify(p.variables) : null,
      p.color
    );
  } finally {
    db.close();
  }
}

export function updateParticipant(p: Participant): void {
  const db = getDb();
  try {
    db.prepare(
      "UPDATE participants SET name = ?, provider = ?, model = ?, identity = ?, identity_file = ?, skills_json = ?, variables_json = ?, color = ? WHERE id = ?"
    ).run(
      p.name,
      p.provider,
      p.model,
      p.identity ?? null,
      p.identityFile ?? null,
      p.skills && p.skills.length > 0 ? JSON.stringify(p.skills) : null,
      p.variables && Object.keys(p.variables).length > 0 ? JSON.stringify(p.variables) : null,
      p.color,
      p.id
    );
  } finally {
    db.close();
  }
}

export function reorderParticipants(orderedIds: string[]): void {
  const db = getDb();
  try {
    const stmt = db.prepare("UPDATE participants SET sort_order = ? WHERE id = ?");
    const txn = transactionFn(db, (ids: string[]) => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i]);
      }
    });
    txn(orderedIds);
  } finally {
    db.close();
  }
}

export function removeParticipant(id: string): void {
  const db = getDb();
  try {
    db.prepare("DELETE FROM participants WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

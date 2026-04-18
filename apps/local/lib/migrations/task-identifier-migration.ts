import type { DatabaseSync } from "node:sqlite";

/**
 * Idempotent migration adding user-configurable task identifier support.
 *
 * - `projects.identifier_prefix` (TEXT, nullable) — e.g. "TSK", "AGX".
 * - `projects.next_identifier` (INTEGER, default 1) — monotonic counter.
 * - `tasks.identifier` (TEXT, nullable) — e.g. "TSK-42".
 * - Partial unique index on (project_id, identifier) where identifier IS NOT NULL.
 *
 * Each step is wrapped in try/catch so it is safe to run repeatedly and on
 * DBs where the columns/index already exist (new schema files, prior runs).
 */
export function runTaskIdentifierMigration(db: DatabaseSync): void {
  try {
    db.exec("ALTER TABLE projects ADD COLUMN identifier_prefix TEXT");
  } catch {
    /* column already exists */
  }
  try {
    db.exec(
      "ALTER TABLE projects ADD COLUMN next_identifier INTEGER NOT NULL DEFAULT 1"
    );
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN identifier TEXT");
  } catch {
    /* column already exists */
  }
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_identifier ON tasks (project_id, identifier) WHERE identifier IS NOT NULL"
    );
  } catch {
    /* already exists */
  }
}

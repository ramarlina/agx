/**
 * Lookup helpers for user-facing task identifiers (e.g. "TSK-42").
 *
 * Backed by the `tasks.identifier` column which is populated on creation when
 * the parent project has an `identifier_prefix` set.
 */

import { getSQLiteDb } from "./sqlite-query-adapter";

/**
 * Find an agx task by its identifier (case-insensitive). Returns `{ id }` (UUID)
 * if exactly one match, otherwise null.
 */
export async function findAgxTaskByIdentifier(
  identifier: string
): Promise<{ id: string } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const db = getSQLiteDb();
  try {
    const row = db
      .prepare(
        "SELECT id FROM tasks WHERE UPPER(identifier) = UPPER(?) LIMIT 1"
      )
      .get(trimmed) as { id: string } | undefined;
    if (!row) return null;
    return { id: row.id };
  } catch {
    // `identifier` column may not exist on very old DBs; treat as miss.
    return null;
  }
}

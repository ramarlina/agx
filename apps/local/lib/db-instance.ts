/**
 * Singleton DbAdapter instance.
 *
 * All business-logic code should import `db` from here instead of
 * reaching into lib/db.ts directly.
 */

import type { DbAdapter } from "./db-adapter.interface";

function createAdapter(): DbAdapter {
  const { SQLiteAdapter } = require("./adapters/sqlite-adapter");
  return new SQLiteAdapter();
}

export const db: DbAdapter = createAdapter();

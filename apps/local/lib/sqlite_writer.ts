/**
 * sqlite_writer.ts — Batch INSERT writer for SQLite migration target.
 *
 * Handles type coercion from PG types to SQLite types and
 * writes batches inside transactions for performance.
 */
import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaSet, pragmaAll, transactionFn } from "./sqlite-compat";
import * as fs from "fs";
import * as path from "path";

export interface SqliteWriterOptions {
  dbPath: string;
  schemaPath?: string;
}

export class SqliteWriter {
  db: DatabaseSync;

  constructor(opts: SqliteWriterOptions) {
    this.db = new DatabaseSyncCtor(opts.dbPath);
    pragmaSet(this.db, "journal_mode = WAL");
    pragmaSet(this.db, "foreign_keys = OFF"); // off during migration, checked after
    pragmaSet(this.db, "synchronous = NORMAL");
  }

  /** Initialize the SQLite schema from the DDL file */
  initSchema(schemaPath: string) {
    const sql = fs.readFileSync(schemaPath, "utf-8");
    // Split on semicolons but skip PRAGMA foreign_keys since we keep it OFF during load
    this.db.exec(sql);
  }

  /** Insert a batch of rows into a table within a transaction */
  insertBatch(
    table: string,
    columns: string[],
    rows: Record<string, unknown>[],
    pgTypes: Map<string, string>
  ) {
    if (rows.length === 0) return;

    const placeholders = columns.map(() => "?").join(", ");
    const quotedCols = columns.map((c) => `"${c}"`).join(", ");
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO "${table}" (${quotedCols}) VALUES (${placeholders})`
    );

    const tx = transactionFn(this.db, (batch: Record<string, unknown>[]) => {
      for (const row of batch) {
        const values = columns.map((col) =>
          coercePgToSqlite(row[col], pgTypes.get(col) ?? "text")
        );
        stmt.run(...values);
      }
    });

    tx(rows);
  }

  /** Get row count for a table */
  getRowCount(table: string): number {
    const row = this.db
      .prepare(`SELECT count(*) AS cnt FROM "${table}"`)
      .get() as { cnt: number };
    return row.cnt;
  }

  /** Compute deterministic checksum matching the PG side.
   *  pgTypes map is needed to normalize values the same way PG does. */
  getTableChecksum(
    table: string,
    columns: { name: string; type: string }[]
  ): string {
    // We read all rows and compute md5 in JS to match PG's md5-based approach
    const crypto = require("crypto");
    const colNames = columns.map((c) => `"${c.name}"`).join(", ");
    const rows = this.db
      .prepare(`SELECT ${colNames} FROM "${table}"`)
      .all() as Record<string, unknown>[];

    const rowHashes: string[] = rows.map((row) => {
      const parts = columns.map((c) => {
        const val = row[c.name];
        if (val === null || val === undefined) return "";

        if (c.type === "timestamptz" || c.type === "timestamp") {
          // SQLite stores as ISO string; normalize to match PG's to_char format
          // PG: YYYY-MM-DDTHH24:MI:SS.MSZ  (milliseconds, 3 digits)
          const s = String(val);
          // Parse and reformat to ensure consistent ms precision
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            const iso = d.toISOString(); // e.g. 2024-01-15T12:30:45.123Z
            // PG to_char with MS gives 3 digits; JS toISOString gives 3 digits — should match
            return iso.replace(/(\.\d{3})\d*Z$/, "$1Z");
          }
          return s;
        }
        if (c.type === "jsonb" || c.type === "json") {
          // Parse and re-stringify to get compact form matching PG's jsonb::text
          try {
            const parsed = typeof val === "string" ? JSON.parse(val) : val;
            return JSON.stringify(parsed);
          } catch {
            return String(val);
          }
        }
        if (c.type.startsWith("_")) {
          // PG arrays stored as JSON arrays
          try {
            const parsed = typeof val === "string" ? JSON.parse(val) : val;
            return JSON.stringify(parsed);
          } catch {
            return String(val);
          }
        }
        if (c.type === "bool") {
          return val ? "1" : "0";
        }
        return String(val);
      });
      const rowText = parts.join("|");
      return crypto.createHash("md5").update(rowText).digest("hex");
    });

    rowHashes.sort();
    const combined = rowHashes.join("");
    return crypto.createHash("md5").update(combined).digest("hex");
  }

  /** Run PRAGMA foreign_key_check and return violations */
  checkForeignKeys(): { table: string; rowid: number; parent: string; fkid: number }[] {
    pragmaSet(this.db, "foreign_keys = ON");
    const violations = pragmaAll(this.db, "foreign_key_check") as {
      table: string;
      rowid: number;
      parent: string;
      fkid: number;
    }[];
    return violations;
  }

  /** Validate all JSON columns contain valid JSON */
  checkJsonColumns(
    table: string,
    jsonColumns: string[]
  ): { column: string; count: number }[] {
    const results: { column: string; count: number }[] = [];
    for (const col of jsonColumns) {
      const row = this.db
        .prepare(
          `SELECT count(*) AS cnt FROM "${table}" WHERE "${col}" IS NOT NULL AND json_valid("${col}") = 0`
        )
        .get() as { cnt: number };
      if (row.cnt > 0) {
        results.push({ column: col, count: row.cnt });
      }
    }
    return results;
  }

  close() {
    this.db.close();
  }
}

/**
 * Coerce a PG value to SQLite-compatible value.
 */
function coercePgToSqlite(
  value: unknown,
  pgType: string
): string | number | null | Buffer {
  if (value === null || value === undefined) return null;

  switch (pgType) {
    // UUIDs → text (already strings from pg driver)
    case "uuid":
      return String(value);

    // Timestamps → ISO-8601 text
    case "timestamptz":
    case "timestamp":
      if (value instanceof Date) return value.toISOString();
      return String(value);

    // JSONB/JSON → stringified
    case "jsonb":
    case "json":
      if (typeof value === "string") return value;
      return JSON.stringify(value);

    // PG arrays (uuid[], text[]) → JSON array strings
    case "_uuid":
    case "_text":
      if (Array.isArray(value)) return JSON.stringify(value);
      return JSON.stringify(value);

    // Booleans → 0/1 integers
    case "bool":
      return value ? 1 : 0;

    // Numeric → real
    case "numeric":
      return Number(value);

    // inet → text
    case "inet":
      return String(value);

    // Integers
    case "int4":
    case "int8":
    case "int2":
      return Number(value);

    // text, varchar, etc. → pass through
    default:
      if (typeof value === "object") return JSON.stringify(value);
      return value as string | number;
  }
}

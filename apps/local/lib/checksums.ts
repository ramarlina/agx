/**
 * checksums.ts — Deterministic per-table checksum and verification utilities.
 *
 * Shared between migrate.ts and verify.ts for consistent cross-DB comparison.
 */
import * as crypto from "crypto";

export interface ColumnDef {
  name: string;
  type: string;
}

/**
 * Normalize a single cell value to a deterministic string representation
 * that matches across PG and SQLite regardless of driver quirks.
 */
export function normalizeValue(val: unknown, pgType: string): string {
  if (val === null || val === undefined) return "";

  if (pgType === "timestamptz" || pgType === "timestamp") {
    if (val instanceof Date) {
      return val.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
    }
    // SQLite stores ISO strings — parse and re-emit for consistency
    const d = new Date(String(val));
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
    }
    return String(val);
  }

  if (pgType === "jsonb" || pgType === "json") {
    if (typeof val === "object") return JSON.stringify(val);
    try {
      return JSON.stringify(JSON.parse(String(val)));
    } catch {
      return String(val);
    }
  }

  if (pgType.startsWith("_")) {
    // PG array types (e.g. _uuid, _text)
    if (Array.isArray(val)) return JSON.stringify(val);
    try {
      return JSON.stringify(JSON.parse(String(val)));
    } catch {
      return JSON.stringify(val);
    }
  }

  if (pgType === "bool") {
    return val ? "1" : "0";
  }

  return String(val);
}

/**
 * Compute a deterministic, order-independent checksum for a set of rows.
 * Each row is hashed individually, hashes are sorted, then combined.
 */
export function computeChecksum(
  rows: Record<string, unknown>[],
  columns: ColumnDef[]
): string {
  const rowHashes: string[] = rows.map((row) => {
    const parts = columns.map((c) => normalizeValue(row[c.name], c.type));
    const rowText = parts.join("|");
    return crypto.createHash("md5").update(rowText).digest("hex");
  });

  rowHashes.sort();
  const combined = rowHashes.join("");
  return crypto.createHash("md5").update(combined).digest("hex");
}

export interface RowCountResult {
  table: string;
  pg: number;
  sqlite: number;
  match: boolean;
}

export interface ChecksumResult {
  table: string;
  pgChecksum: string;
  sqliteChecksum: string;
  match: boolean;
}

export interface FkViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

export interface JsonInvalid {
  table: string;
  column: string;
  count: number;
}

export interface VerificationReport {
  rowCounts: RowCountResult[];
  checksums: ChecksumResult[];
  fkViolations: FkViolation[];
  jsonInvalid: JsonInvalid[];
  passed: boolean;
}

import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import fs from "fs";
import { initDatabase, applyPragmas } from "@/src/db/init";
import { checkVersion, checkExtensions, checkFilesystem } from "@/src/db/checks";
import { pragmaGet } from "@/lib/sqlite-compat";

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-db-test-"));
  return path.join(dir, "test.db");
}

describe("checkVersion", () => {
  test("accepts current SQLite version (>= 3.35)", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => checkVersion(db)).not.toThrow();
    db.close();
  });

  test("rejects SQLite version below 3.35", () => {
    const db = new DatabaseSync(":memory:");
    // Mock sqlite_version() by overriding the prepare method
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.includes("sqlite_version")) {
        return { get: () => ({ v: "3.34.1" }) };
      }
      return origPrepare(sql);
    }) as typeof db.prepare;

    expect(() => checkVersion(db)).toThrow(/below minimum required 3.35.0/);
    db.close();
  });
});

describe("checkExtensions", () => {
  test("JSON1 is available in node:sqlite", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => checkExtensions(db)).not.toThrow();
    db.close();
  });

  test("throws when JSON1 is missing", () => {
    const db = new DatabaseSync(":memory:");
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.includes("json(")) {
        throw new Error("no such function: json");
      }
      return origPrepare(sql);
    }) as typeof db.prepare;

    expect(() => checkExtensions(db)).toThrow(/JSON1/);
    db.close();
  });
});

describe("applyPragmas", () => {
  test("applies all required PRAGMAs", () => {
    const dbPath = tmpDbPath();
    const db = new DatabaseSync(dbPath);

    applyPragmas(db);

    expect(pragmaGet(db, "journal_mode")).toBe("wal");
    expect(pragmaGet(db, "foreign_keys")).toBe(1);
    expect(pragmaGet(db, "busy_timeout")).toBe(5000);
    expect(pragmaGet(db, "synchronous")).toBe(1); // NORMAL = 1
    expect(pragmaGet(db, "cache_size")).toBe(-64000);

    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true });
  });

  test("accepts custom PRAGMA values", () => {
    const dbPath = tmpDbPath();
    const db = new DatabaseSync(dbPath);

    applyPragmas(db, { busyTimeout: 10000, synchronous: "FULL", cacheSize: -32000 });

    expect(pragmaGet(db, "busy_timeout")).toBe(10000);
    expect(pragmaGet(db, "synchronous")).toBe(2); // FULL = 2
    expect(pragmaGet(db, "cache_size")).toBe(-32000);

    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true });
  });
});

describe("initDatabase", () => {
  test("returns a configured database on valid environment", () => {
    const dbPath = tmpDbPath();
    const db = initDatabase(dbPath);

    expect(pragmaGet(db, "journal_mode")).toBe("wal");
    expect(pragmaGet(db, "foreign_keys")).toBe(1);

    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true });
  });

  test("database is functional after init", () => {
    const dbPath = tmpDbPath();
    const db = initDatabase(dbPath);

    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");
    db.prepare("INSERT INTO test (data) VALUES (?) RETURNING id").get("hello");

    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true });
  });
});

describe("checkFilesystem", () => {
  test("does not throw on macOS/non-Linux", () => {
    if (os.platform() !== "linux") {
      expect(() => checkFilesystem("/tmp/test.db")).not.toThrow();
    }
  });
});

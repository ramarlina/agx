/**
 * @jest-environment node
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_SQLITE_DB_PATH = process.env.SQLITE_DB_PATH;

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function loadBoardSchema(root: string): string {
  return fs.readFileSync(path.join(root, "db/sqlite/001_agx_board_schema.sql"), "utf8");
}

describe("sqlite startup team schema migration", () => {
  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_SQLITE_DB_PATH === undefined) {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = ORIGINAL_SQLITE_DB_PATH;
    }
    jest.resetModules();
  });

  test("startup does not drop project-scoped team tables after the legacy migration marker exists", async () => {
    const root = repoRoot();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sqlite-team-schema-"));
    const dbPath = path.join(tempDir, "agx-board.db");
    const seedDb = new DatabaseSync(dbPath);

    seedDb.exec(loadBoardSchema(root));
    seedDb.exec(`
      CREATE TABLE IF NOT EXISTS app_migrations (
        key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        metadata JSON
      );
    `);
    seedDb.prepare("INSERT INTO projects (id, user_id, name, slug) VALUES (?, ?, ?, ?)").run(
      "project-1",
      "user-1",
      "Project One",
      "project-one"
    );
    seedDb.prepare("INSERT INTO agents (id, user_id, name, style) VALUES (?, ?, ?, ?)").run(
      "agent-1",
      "user-1",
      "Agent One",
      "balanced"
    );
    seedDb.prepare(
      "INSERT INTO teams (id, project_id, name, template_id, metadata) VALUES (?, ?, ?, ?, json(?))"
    ).run("team-1", "project-1", "Engineering", "engineering", "{}");
    seedDb.prepare(
      "INSERT INTO team_agents (team_id, agent_id, role_key, routing_order) VALUES (?, ?, ?, ?)"
    ).run("team-1", "agent-1", "backend-engineer", 0);
    seedDb.prepare("INSERT INTO app_migrations (key, metadata) VALUES (?, json(?))").run(
      "legacy_workspaces_to_projects_v1",
      "{}"
    );
    seedDb.close();

    process.chdir(root);
    process.env.SQLITE_DB_PATH = dbPath;
    jest.resetModules();

    const { getSQLiteDb } = await import("@/lib/sqlite-query-adapter");
    const db = getSQLiteDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('team_agents', 'teams') ORDER BY name ASC"
      )
      .all() as { name: string }[];

    expect(tables.map((row) => row.name)).toEqual(["team_agents", "teams"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM team_agents").get() as { n: number }).n).toBe(1);

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

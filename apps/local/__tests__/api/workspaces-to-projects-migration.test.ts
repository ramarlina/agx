/**
 * @jest-environment node
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

const mockGetSQLiteDb = jest.fn();

jest.mock("@/lib/sqlite-query-adapter", () => ({
  getSQLiteDb: () => mockGetSQLiteDb(),
}));

function loadBoardSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "db/sqlite/001_agx_board_schema.sql"), "utf8");
}

describe("/api/migrate/workspaces-to-projects", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new DatabaseSync(":memory:");
    db.exec(loadBoardSchema());
    db.prepare("INSERT INTO projects (id, user_id, name, slug) VALUES (?, ?, ?, ?)").run(
      "project-1",
      "user-1",
      "Project One",
      "project-one"
    );
    db.prepare("INSERT INTO agents (id, user_id, name, style) VALUES (?, ?, ?, ?)").run(
      "agent-1",
      "user-1",
      "Agent One",
      "balanced"
    );
    db.prepare(
      "INSERT INTO teams (id, project_id, name, template_id, metadata) VALUES (?, ?, ?, ?, json(?))"
    ).run("team-1", "project-1", "Engineering", "engineering", "{}");
    db.prepare(
      "INSERT INTO team_agents (team_id, agent_id, role_key, routing_order) VALUES (?, ?, ?, ?)"
    ).run("team-1", "agent-1", "backend-engineer", 0);
    mockGetSQLiteDb.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  test("GET ignores project-scoped team tables when reporting legacy migration counts", async () => {
    const { GET } = await import("@/app/api/migrate/workspaces-to-projects/route");
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.teams).toBe(0);
    expect(data.teamAgents).toBe(0);
    expect(data.teamWorkspaces).toBe(0);
    expect(data.projects).toBe(1);
    expect(data.projectAgents).toBe(0);
  });
});

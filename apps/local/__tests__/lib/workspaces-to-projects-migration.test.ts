/**
 * @jest-environment node
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

import {
  autoMigrateLegacyWorkspacesToProjects,
  getLegacyWorkspaceSourceCounts,
  getWorkspaceTeamTableState,
} from "@/lib/workspaces-to-projects-migration";

function loadBoardSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "db/sqlite/001_agx_board_schema.sql"), "utf8");
}

function createProjectScopedTeamDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
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
  return db;
}

function createLegacyTeamDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      is_default INTEGER DEFAULT 0
    );
    CREATE TABLE team_agents (
      team_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      routing_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, agent_id)
    );
    CREATE TABLE team_workspaces (
      team_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (team_id, thread_id)
    );
  `);
  db.prepare("INSERT INTO teams (id, name, user_id, is_default) VALUES (?, ?, ?, ?)").run(
    "team-legacy",
    "Default",
    "user-1",
    1
  );
  db.prepare("INSERT INTO team_agents (team_id, agent_id, routing_order) VALUES (?, ?, ?)").run(
    "team-legacy",
    "agent-1",
    0
  );
  db.prepare("INSERT INTO team_workspaces (team_id, thread_id) VALUES (?, ?)").run(
    "team-legacy",
    "thread-1"
  );
  return db;
}

function createPartialLegacyTeamDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE team_workspaces (
      team_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (team_id, thread_id)
    );
  `);
  db.prepare("INSERT INTO team_workspaces (team_id, thread_id) VALUES (?, ?)").run(
    "team-legacy",
    "thread-1"
  );
  return db;
}

describe("workspace-to-projects migration schema detection", () => {
  test("treats the new project-scoped team tables as non-legacy input", () => {
    const db = createProjectScopedTeamDb();

    expect(getWorkspaceTeamTableState(db)).toEqual({
      legacyTeams: false,
      legacyTeamAgents: false,
      legacyTeamWorkspaces: false,
      projectScopedTeams: true,
      projectScopedTeamAgents: true,
    });
    expect(getLegacyWorkspaceSourceCounts(db)).toEqual({
      teams: 0,
      teamAgents: 0,
      teamWorkspaces: 0,
    });
    expect(autoMigrateLegacyWorkspacesToProjects(db)).toBeNull();

    db.close();
  });

  test("still recognizes the old workspace-scoped team schema", () => {
    const db = createLegacyTeamDb();

    expect(getWorkspaceTeamTableState(db)).toEqual({
      legacyTeams: true,
      legacyTeamAgents: true,
      legacyTeamWorkspaces: true,
      projectScopedTeams: false,
      projectScopedTeamAgents: false,
    });
    expect(getLegacyWorkspaceSourceCounts(db)).toEqual({
      teams: 1,
      teamAgents: 1,
      teamWorkspaces: 1,
    });

    db.close();
  });

  test("refuses to auto-migrate partial legacy table residue", () => {
    const db = createPartialLegacyTeamDb();

    expect(autoMigrateLegacyWorkspacesToProjects(db)).toBeNull();
    expect(getLegacyWorkspaceSourceCounts(db)).toEqual({
      teams: 0,
      teamAgents: 0,
      teamWorkspaces: 1,
    });

    db.close();
  });
});

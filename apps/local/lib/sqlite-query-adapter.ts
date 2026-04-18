/**
 * SQLite QueryBuilder — drop-in replacement for the Postgres QueryBuilder in db-adapter.ts.
 *
 * Translates the same fluent API (.from().select().eq().single() etc.) into
 * SQLite-compatible SQL executed via node:sqlite.
 *
 * Key dialect differences handled:
 *  - Parameterised placeholders: $N → ?
 *  - = ANY($N)         → IN (?, ?, …)
 *  - @> (array contains)→ json_each + IN sub-query
 *  - IS NOT DISTINCT FROM → IS
 *  - ILIKE              → LIKE (SQLite LIKE is case-insensitive for ASCII by default)
 *  - NULLS FIRST/LAST  → CASE expression
 *  - RETURNING          → supported in SQLite ≥ 3.35
 */

import type { DatabaseSync } from "node:sqlite";
// Use process.getBuiltinModule() to retrieve node:sqlite at runtime. Avoids Turbopack's
// ESM e.x() thunk (broken after HMR re-eval) and its CJS external resolver (can't handle
// node: URL scheme). The function call is invisible to the bundler's module graph.
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaAll } from "./sqlite-compat";
import fs from "fs";
import path from "path";
import os from "os";
import { LOCAL_USER } from "./auth-mode";
import { ensureAgent, listAgents, readIdentity } from "./mesh-core/agent";
import { loadParticipants } from "./participants-store";
import { validateSQLiteEnvironment } from "./startup";
import {
  autoMigrateLegacyWorkspacesToProjects,
  getWorkspaceTeamTableState,
} from "./workspaces-to-projects-migration";
import { runTaskIdentifierMigration } from "./migrations/task-identifier-migration";

const AGX_DATA_DIR = process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx");

// ── SQL Expression marker ───────────────────────────────────────────────────

/**
 * Wrap a raw SQL expression so the query builder emits it verbatim
 * instead of binding a parameter.  Usage:
 *   .update({ version: sqlExpr("version + 1") })
 */
export class SqlExpression {
  constructor(public readonly expr: string) {}
}
export function sqlExpr(expr: string): SqlExpression {
  return new SqlExpression(expr);
}

// ── Singleton connection ────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getSQLiteDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath =
    process.env.SQLITE_DB_PATH ||
    path.join(AGX_DATA_DIR, "agx-board.db");

  _db = new DatabaseSyncCtor(dbPath);

  // Validate environment (applies PRAGMAs, checks version/extensions)
  const errors = validateSQLiteEnvironment(_db, dbPath);
  if (errors.length > 0) {
    const msgs = errors.map((e) => `  - ${e.message}${e.fix ? ` (fix: ${e.fix})` : ""}`);
    throw new Error(`SQLite startup validation failed:\n${msgs.join("\n")}`);
  }

  // Ensure all tables exist (idempotent DDL), then run migrations
  initSQLiteSchema(_db);
  runMigrations(_db);
  const autoMigrationResult = autoMigrateLegacyWorkspacesToProjects(_db);
  if (autoMigrationResult) {
    console.log(
      `[sqlite] auto-migrated legacy workspaces to projects: ${JSON.stringify({
        usersProcessed: autoMigrationResult.usersProcessed,
        projectsCreated: autoMigrationResult.projectsCreated,
        projectsMatched: autoMigrationResult.projectsMatched,
        projectAgentsLinked: autoMigrationResult.projectAgentsLinked,
        projectThreadsLinked: autoMigrationResult.projectThreadsLinked,
      })}`
    );
  }

  // Drop legacy teams tables after migration is complete
  dropLegacyTeamsTables(_db);
  ensureProjectScopedTeamTables(_db);

  return _db;
}

function initSQLiteSchema(db: DatabaseSync): void {
  const ddlPath = path.join(process.cwd(), "db", "sqlite", "001_agx_board_schema.sql");
  if (!fs.existsSync(ddlPath)) {
    console.warn(`[sqlite] DDL not found at ${ddlPath}, skipping schema init`);
    return;
  }
  const ddl = fs.readFileSync(ddlPath, "utf-8");
  db.exec(ddl);
}

// ── Runtime migrations (idempotent) ──────────────────────────────────────────

function dropLegacyTeamsTables(db: DatabaseSync): void {
  // Only drop if auto-migration has already run
  const hasMigrations = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_migrations'").get();
  if (!hasMigrations) return;
  const migrated = db.prepare("SELECT 1 FROM app_migrations WHERE key = 'legacy_workspaces_to_projects_v1' LIMIT 1").get();
  if (!migrated) return;

  const state = getWorkspaceTeamTableState(db);
  const dropped: string[] = [];
  if (state.legacyTeamWorkspaces) dropped.push("team_workspaces");
  if (state.legacyTeamAgents) dropped.push("team_agents");
  if (state.legacyTeams) dropped.push("teams");
  if (dropped.length === 0) return;

  db.exec(dropped.map((table) => `DROP TABLE IF EXISTS ${table};`).join("\n"));
  console.log(`[sqlite] dropped legacy team tables: ${dropped.join(", ")}`);
}

function ensureProjectScopedTeamTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      template_id TEXT,
      metadata JSON NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_teams_project_id ON teams (project_id);

    CREATE TABLE IF NOT EXISTS team_agents (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role_key TEXT NOT NULL,
      routing_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_agents_agent_id ON team_agents (agent_id);

    CREATE TRIGGER IF NOT EXISTS teams_updated_at
      AFTER UPDATE ON teams
      FOR EACH ROW
      BEGIN
        UPDATE teams SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
      END;
  `);
}

function runMigrations(db: DatabaseSync): void {
  const graphTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_graphs'")
    .all();
  if (graphTables.length > 0) {
    const columns = pragmaAll(db, "table_info(execution_graphs)") as { name: string }[];
    if (!columns.some((column) => column.name === "schedule")) {
      db.exec("ALTER TABLE execution_graphs ADD COLUMN schedule JSON");
    }
  }

  // Add identifier_prefix/next_identifier to projects and identifier to tasks
  runTaskIdentifierMigration(db);

  // Add archived_at column to projects for soft delete
  const projectTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    .all();
  if (projectTables.length > 0) {
    const projectCols = pragmaAll(db, "table_info(projects)") as { name: string }[];
    if (!projectCols.some((column) => column.name === "archived_at")) {
      db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT DEFAULT NULL");
    }
  }

  const projectMemoryTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_memory'")
    .all();
  if (projectMemoryTables.length > 0) {
    const projectMemoryCols = pragmaAll(db, "table_info(project_memory)") as { name: string }[];
    if (!projectMemoryCols.some((column) => column.name === "producer")) {
      db.exec("ALTER TABLE project_memory ADD COLUMN producer TEXT NOT NULL DEFAULT 'human' CHECK(producer IN ('human', 'system'))");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_project_memory_producer ON project_memory (producer)");
  }

  // Add new agent identity columns (voice, seed, model, provider, color)
  const agentTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").all();
  if (agentTables.length > 0) {
    const agentCols = pragmaAll(db, "table_info(agents)") as { name: string }[];
    const agentColNames = new Set(agentCols.map((c) => c.name));
    if (!agentColNames.has("voice")) db.exec("ALTER TABLE agents ADD COLUMN voice TEXT");
    if (!agentColNames.has("seed")) db.exec("ALTER TABLE agents ADD COLUMN seed TEXT");
    if (!agentColNames.has("model")) db.exec("ALTER TABLE agents ADD COLUMN model TEXT");
    if (!agentColNames.has("provider")) db.exec("ALTER TABLE agents ADD COLUMN provider TEXT");
    if (!agentColNames.has("color")) db.exec("ALTER TABLE agents ADD COLUMN color TEXT");
    if (agentColNames.has("title") && !agentColNames.has("role")) {
      db.exec("ALTER TABLE agents RENAME COLUMN title TO role");
    } else if (!agentColNames.has("role")) {
      db.exec("ALTER TABLE agents ADD COLUMN role TEXT");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      file TEXT NOT NULL,
      condition TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (agent_id, file)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills (agent_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_learning_history (
      id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      provider TEXT NOT NULL,
      repo TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_label TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
      command TEXT NOT NULL,
      error TEXT,
      run_started_at INTEGER,
      run_completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_skill_learning_history_provider_status_updated ON skill_learning_history(provider, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skill_learning_history_skill_lookup ON skill_learning_history(provider, repo, skill_id, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skill_bindings (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      repo TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      condition TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (agent_id, repo, skill_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skill_bindings_agent ON agent_skill_bindings (agent_id, created_at);
  `);

  ensureProjectScopedTeamTables(db);

  // Create project_agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_agents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      routing_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (project_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents (project_id, routing_order);
    CREATE INDEX IF NOT EXISTS idx_project_agents_agent ON project_agents (agent_id);
  `);

  // Create project_skills table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_skills (
      id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file TEXT NOT NULL,
      condition TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_skills_project ON project_skills (project_id);
  `);

  // Create project_variables table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_variables (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (project_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_project_variables_project ON project_variables (project_id);
  `);

  // Create project_memory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_memory (
      id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source TEXT,
      producer TEXT NOT NULL DEFAULT 'human' CHECK(producer IN ('human', 'system')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_memory_project ON project_memory (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_project_memory_producer ON project_memory (producer);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS repo_knowledge (
      id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
      repo_id TEXT NOT NULL REFERENCES project_repos(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      producer TEXT NOT NULL CHECK(producer IN ('human', 'system')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_repo_knowledge_repo ON repo_knowledge (repo_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_repo_knowledge_producer ON repo_knowledge (producer);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT NOT NULL PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('agent', 'repo', 'project')),
      subject_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('reflection', 'thread_transition', 'task_completion')),
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('outcome', 'decision', 'pattern', 'gotcha', 'preference', 'constraint', 'convention', 'lesson')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      confidence REAL,
      durability REAL,
      tags JSON NOT NULL DEFAULT '[]',
      evidence JSON NOT NULL DEFAULT '[]',
      metadata JSON NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(scope, subject_id, content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_scope_subject ON knowledge_entries (scope, subject_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_source ON knowledge_entries (source_type, source_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_notes (
      id TEXT NOT NULL PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('agent', 'repo', 'project')),
      subject_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      change_summary TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('reflection', 'thread_transition', 'task_completion')),
      source_id TEXT NOT NULL,
      metadata JSON NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(scope, subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_notes_scope_subject ON knowledge_notes (scope, subject_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_note_versions (
      id TEXT NOT NULL PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES knowledge_notes(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      change_summary TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('reflection', 'thread_transition', 'task_completion')),
      source_id TEXT NOT NULL,
      metadata JSON NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_note_versions_note_version
      ON knowledge_note_versions (note_id, version DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_knowledge_runs (
      id TEXT NOT NULL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      root_message_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      requested_scopes JSON NOT NULL DEFAULT '[]',
      repo_inserted_count INTEGER NOT NULL DEFAULT 0,
      project_inserted_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_thread_knowledge_runs_root_created
      ON thread_knowledge_runs (root_message_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_thread_knowledge_runs_thread_created
      ON thread_knowledge_runs (thread_id, created_at DESC);
  `);

  // Create project_threads table (replaces team_workspaces)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_threads (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (project_id, thread_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_threads_thread ON project_threads (thread_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      metadata JSON
    );
  `);

  // Legacy workspace/team migration is explicit now.
  // Do not auto-populate project mappings here, or stale legacy rows will be
  // reintroduced on every DB open. Use the dedicated workspaces→projects
  // migration script/route instead.

  // Recreate graph_nodes to add 'function' to the type CHECK constraint
  const gnTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes'").all();
  if (gnTables.length > 0) {
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_nodes'").get() as { sql: string } | undefined)?.sql ?? "";
    if (sql.includes("'root')") && !sql.includes("'function'")) {
      db.exec(`
        CREATE TABLE graph_nodes_new (
          graph_id TEXT NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          config JSON NOT NULL DEFAULT '{}',
          output JSON,
          metrics JSON,
          PRIMARY KEY (graph_id, node_id),
          CHECK (type IN ('work', 'gate', 'fork', 'join', 'conditional', 'root', 'function')),
          CHECK (status IN ('pending', 'running', 'awaiting_human', 'done', 'passed', 'failed', 'blocked', 'skipped', 'stopped'))
        );
        INSERT INTO graph_nodes_new SELECT * FROM graph_nodes;
        DROP TABLE graph_nodes;
        ALTER TABLE graph_nodes_new RENAME TO graph_nodes;
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_graph_id ON graph_nodes (graph_id);
      `);
    }
  }

  // Add 'paused' to graph_nodes status CHECK constraint
  if (gnTables.length > 0) {
    const gnSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_nodes'").get() as { sql: string } | undefined)?.sql ?? "";
    if (gnSql.includes("'stopped')") && !gnSql.includes("'paused'")) {
      db.exec(`
        CREATE TABLE graph_nodes_new2 (
          graph_id TEXT NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          config JSON NOT NULL DEFAULT '{}',
          output JSON,
          metrics JSON,
          PRIMARY KEY (graph_id, node_id),
          CHECK (type IN ('work', 'gate', 'fork', 'join', 'conditional', 'root', 'function')),
          CHECK (status IN ('pending', 'running', 'awaiting_human', 'done', 'passed', 'failed', 'blocked', 'skipped', 'stopped', 'paused'))
        );
        INSERT INTO graph_nodes_new2 SELECT * FROM graph_nodes;
        DROP TABLE graph_nodes;
        ALTER TABLE graph_nodes_new2 RENAME TO graph_nodes;
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_graph_id ON graph_nodes (graph_id);
      `);
    }
  }

  // ── Task Groups ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_groups (
      id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled',
      position INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_groups_project_id ON task_groups (project_id);

    CREATE TRIGGER IF NOT EXISTS task_groups_updated_at
      AFTER UPDATE ON task_groups
      FOR EACH ROW
      BEGIN
        UPDATE task_groups SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
      END;
  `);

  // Join table for group ↔ item membership (works with any external ID, e.g. Linear issues)
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_group_items (
      group_id TEXT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      item_id  TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_group_items_item ON task_group_items (item_id);
  `);

  backfillAgentsFromFilesystem(db);
  backfillAgentSkillsFromLegacyParticipants(db);
  ensureRuntimeArtifactsForDbAgents(db);

}

function backfillAgentsFromFilesystem(db: DatabaseSync): void {
  const upsertAgent = db.prepare(
    `INSERT INTO agents (id, user_id, name, style, description, voice, seed)
     VALUES (?, ?, ?, 'balanced', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(NULLIF(agents.name, ''), excluded.name),
       voice = COALESCE(NULLIF(agents.voice, ''), excluded.voice),
       seed = COALESCE(NULLIF(agents.seed, ''), excluded.seed),
       updated_at = CASE
         WHEN COALESCE(NULLIF(agents.voice, ''), '') = '' OR COALESCE(NULLIF(agents.seed, ''), '') = ''
           THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
         ELSE agents.updated_at
       END`
  );

  for (const agentId of listAgents()) {
    const identity = readIdentity(agentId);
    upsertAgent.run(
      agentId,
      LOCAL_USER.id,
      identity?.name?.trim() || agentId,
      identity?.voice?.trim() || null,
      identity?.seed?.trim() || null
    );
  }
}

function backfillAgentSkillsFromLegacyParticipants(db: DatabaseSync): void {
  const participants = loadParticipants();
  const existingAgents = new Set(
    (db.prepare("SELECT id FROM agents").all() as Array<{ id: string }>).map((row) => row.id)
  );
  const upsertSkill = db.prepare(
    `INSERT INTO agent_skills (agent_id, file, condition)
     VALUES (?, ?, ?)
     ON CONFLICT(agent_id, file) DO UPDATE SET
       condition = excluded.condition`
  );

  for (const participant of participants) {
    if (!existingAgents.has(participant.id)) continue;
    for (const skill of participant.skills ?? []) {
      const file = skill.file?.trim();
      if (!file) continue;
      upsertSkill.run(participant.id, file, skill.condition?.trim() || null);
    }
  }
}

function ensureRuntimeArtifactsForDbAgents(db: DatabaseSync): void {
  const agents = db
    .prepare("SELECT id, voice, seed FROM agents")
    .all() as Array<{ id: string; voice: string | null; seed: string | null }>;

  for (const agent of agents) {
    ensureAgent(agent.id, {
      voice: agent.voice ?? undefined,
      seed: agent.seed ?? undefined,
    });
  }
}

// ── JSON column set (same as db-adapter.ts) ─────────────────────────────────

const JSON_COLUMNS = new Set([
  "definition",
  "depends_on",
  "input",
  "metadata",
  "models",
  "open_blockers",
  "output",
  "payload",
  "run_index",
  "stage_decisions",
  "swarm_models",
]);

function toSqlValue(value: any): any {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function toSqlValueForColumn(column: string, value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (JSON_COLUMNS.has(column)) {
    return JSON.stringify(value);
  }
  return toSqlValue(value);
}

function parseOrValue(raw: string): any {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

function normalizeColumns(columns?: string): { columns: string[]; includeProjectRepos: boolean } {
  const text = (columns || "*").trim();
  if (!text || text === "*") return { columns: ["*"], includeProjectRepos: false };
  const includeProjectRepos = text.includes("project_repos(*)");
  const cleaned = text
    .replace(/project_repos\(\*\)/g, "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (cleaned.length === 0) return { columns: ["*"], includeProjectRepos };
  return { columns: cleaned, includeProjectRepos };
}

// ── Filter types (same as Postgres adapter) ─────────────────────────────────

type OrderSpec = { column: string; ascending?: boolean; nullsFirst?: boolean };

type Filter =
  | { op: "eq"; column: string; value: any }
  | { op: "neq"; column: string; value: any }
  | { op: "gt"; column: string; value: any }
  | { op: "gte"; column: string; value: any }
  | { op: "lt"; column: string; value: any }
  | { op: "lte"; column: string; value: any }
  | { op: "is"; column: string; value: any }
  | { op: "in"; column: string; value: any[] }
  | { op: "or"; expression: string }
  | { op: "contains"; column: string; value: any[] };

type QueryResult<T = any> = { data: T; error: any };

// ── SQLite QueryBuilder ─────────────────────────────────────────────────────

class SQLiteQueryBuilder {
  private table: string;
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: Filter[] = [];
  private orderSpecs: OrderSpec[] = [];
  private limitValue: number | null = null;
  private selectColumns = "*";
  private returningColumns: string | null = null;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  private payload: any = null;
  private upsertOptions: any = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = "*") {
    if (this.operation === "select") {
      this.selectColumns = columns;
    } else {
      this.returningColumns = columns || "*";
    }
    return this;
  }

  insert(payload: any) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  upsert(payload: any, options?: any) {
    this.operation = "upsert";
    this.payload = payload;
    this.upsertOptions = options || {};
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push({ op: "gt", column, value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ op: "gte", column, value });
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push({ op: "lte", column, value });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ op: "is", column, value });
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push({ op: "in", column, value: values || [] });
    return this;
  }

  contains(column: string, value: any[]) {
    this.filters.push({ op: "contains", column, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ op: "or", expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderSpecs.push({ column, ...(options || {}) });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  then(resolve: any, reject: any) {
    return this.execute().then(resolve, reject);
  }

  // ── WHERE clause builder (SQLite dialect) ──────────────────────────────

  private buildWhere(parts: string[], params: any[]) {
    for (const f of this.filters) {
      if (f.op === "or") {
        const clauses = f.expression
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .map((clause) => {
            const [column, op, ...rest] = clause.split(".");
            const raw = rest.join(".");
            const value = parseOrValue(raw);
            if (op === "eq") {
              params.push(toSqlValue(value));
              return `${column} = ?`;
            }
            if (op === "neq") {
              params.push(toSqlValue(value));
              return `${column} <> ?`;
            }
            if (op === "is") {
              if (value === null) return `${column} IS NULL`;
              params.push(toSqlValue(value));
              return `${column} IS ?`;
            }
            if (op === "ilike") {
              // SQLite LIKE is case-insensitive for ASCII letters
              params.push(toSqlValue(value));
              return `${column} LIKE ?`;
            }
            if (op === "like") {
              params.push(toSqlValue(value));
              return `${column} LIKE ?`;
            }
            return "1=1";
          });
        if (clauses.length > 0) {
          parts.push(`(${clauses.join(" OR ")})`);
        }
        continue;
      }

      if (f.op === "eq") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} = ?`);
      } else if (f.op === "neq") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} <> ?`);
      } else if (f.op === "gt") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} > ?`);
      } else if (f.op === "gte") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} >= ?`);
      } else if (f.op === "lt") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} < ?`);
      } else if (f.op === "lte") {
        params.push(toSqlValue(f.value));
        parts.push(`${f.column} <= ?`);
      } else if (f.op === "is") {
        if (f.value === null) {
          parts.push(`${f.column} IS NULL`);
        } else {
          params.push(toSqlValue(f.value));
          parts.push(`${f.column} IS ?`);
        }
      } else if (f.op === "contains") {
        // Postgres @> for arrays → SQLite: check each element via json_each
        const arr = (f.value || []).map(toSqlValue);
        if (arr.length === 0) {
          parts.push("1=1");
        } else {
          const placeholders = arr.map(() => "?").join(", ");
          params.push(...arr);
          parts.push(
            `(SELECT COUNT(*) FROM json_each(${f.column}) WHERE json_each.value IN (${placeholders})) = ${arr.length}`
          );
        }
      } else if (f.op === "in") {
        if (!f.value || f.value.length === 0) {
          parts.push("1=0");
        } else {
          const vals = (f.value || []).map(toSqlValue);
          const placeholders = vals.map(() => "?").join(", ");
          params.push(...vals);
          parts.push(`${f.column} IN (${placeholders})`);
        }
      }
    }
  }

  // ── SELECT ─────────────────────────────────────────────────────────────

  private executeSelect(): QueryResult<any> {
    try {
      const db = getSQLiteDb();
      const { columns, includeProjectRepos } = normalizeColumns(this.selectColumns);
      const params: any[] = [];
      const where: string[] = [];
      this.buildWhere(where, params);

      let sql = `SELECT ${columns.join(", ")} FROM ${this.table}`;
      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      if (this.orderSpecs.length > 0) {
        const order = this.orderSpecs
          .map((o) => {
            const direction = o.ascending === false ? "DESC" : "ASC";
            // SQLite doesn't support NULLS FIRST/LAST directly — use CASE
            if (o.nullsFirst === true) {
              return `CASE WHEN ${o.column} IS NULL THEN 0 ELSE 1 END, ${o.column} ${direction}`;
            }
            if (o.nullsFirst === false) {
              return `CASE WHEN ${o.column} IS NULL THEN 1 ELSE 0 END, ${o.column} ${direction}`;
            }
            return `${o.column} ${direction}`;
          })
          .join(", ");
        sql += ` ORDER BY ${order}`;
      }
      if (typeof this.limitValue === "number") {
        params.push(this.limitValue);
        sql += ` LIMIT ?`;
      }

      let rows = db.prepare(sql).all(...params) as any[];

      // Parse JSON columns back to objects
      rows = rows.map(parseJsonColumns);

      if (includeProjectRepos && this.table === "projects" && rows.length > 0) {
        const ids = rows.map((r) => r.id).filter(Boolean);
        if (ids.length > 0) {
          const placeholders = ids.map(() => "?").join(", ");
          const reposRows = db
            .prepare(`SELECT * FROM project_repos WHERE project_id IN (${placeholders})`)
            .all(...ids) as any[];
          const byProject = new Map<string, any[]>();
          for (const repo of reposRows) {
            const list = byProject.get(repo.project_id) || [];
            list.push(repo);
            byProject.set(repo.project_id, list);
          }
          rows = rows.map((p) => ({ ...p, project_repos: byProject.get(p.id) || [] }));
        }
      }

      if (this.singleMode === "single") {
        if (rows.length === 0) {
          return { data: null, error: { message: "No rows", code: "PGRST116" } };
        }
        return { data: rows[0], error: null };
      }

      if (this.singleMode === "maybeSingle") {
        return { data: rows[0] || null, error: null };
      }

      return { data: rows, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }

  // ── INSERT / UPSERT ───────────────────────────────────────────────────

  private executeInsertOrUpsert(): QueryResult<any> {
    try {
      const db = getSQLiteDb();
      const inputRows: Array<Record<string, any>> = Array.isArray(this.payload)
        ? this.payload
        : [this.payload];
      if (!inputRows.length) return { data: [], error: null };

      const columns: string[] = Array.from(
        inputRows.reduce((set: Set<string>, row: Record<string, any>) => {
          for (const key of Object.keys(row || {})) set.add(key);
          return set;
        }, new Set<string>())
      );

      const values: any[] = [];
      const groups = inputRows.map((row: Record<string, any>) => {
        const placeholders = columns.map((col) => {
          values.push(toSqlValueForColumn(col, row[col]));
          return "?";
        });
        return `(${placeholders.join(", ")})`;
      });

      let sql = `INSERT INTO ${this.table} (${columns.join(", ")}) VALUES ${groups.join(", ")}`;

      if (this.operation === "upsert") {
        const onConflictRaw = this.upsertOptions?.onConflict || "";
        const conflictCols = String(onConflictRaw)
          .split(",")
          .map((v: string) => v.trim())
          .filter(Boolean);
        if (conflictCols.length > 0) {
          if (this.upsertOptions?.ignoreDuplicates) {
            sql += ` ON CONFLICT (${conflictCols.join(", ")}) DO NOTHING`;
          } else {
            const updates = columns
              .filter((c) => !conflictCols.includes(c))
              .map((c) => `${c} = EXCLUDED.${c}`);
            if (updates.length > 0) {
              sql += ` ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${updates.join(", ")}`;
            } else {
              sql += ` ON CONFLICT (${conflictCols.join(", ")}) DO NOTHING`;
            }
          }
        }
      }

      if (this.returningColumns) {
        const { columns: retCols } = normalizeColumns(this.returningColumns);
        sql += ` RETURNING ${retCols.join(", ")}`;
      }

      let resultRows: any[];
      if (this.returningColumns) {
        resultRows = db.prepare(sql).all(...values) as any[];
        resultRows = resultRows.map(parseJsonColumns);
      } else {
        db.prepare(sql).run(...values);
        resultRows = [];
      }

      const data = this.returningColumns ? resultRows : null;

      if (this.singleMode === "single" || this.singleMode === "maybeSingle") {
        return { data: (data && data[0]) || null, error: null };
      }
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }

  // ── UPDATE / DELETE ───────────────────────────────────────────────────

  private executeUpdateOrDelete(): QueryResult<any> {
    try {
      const db = getSQLiteDb();
      const setParams: any[] = [];
      const whereParams: any[] = [];
      const where: string[] = [];
      this.buildWhere(where, whereParams);

      let sql = "";
      if (this.operation === "update") {
        const keys = Object.keys(this.payload || {});
        const assignments = keys.map((k) => {
          const val = this.payload[k];
          if (val instanceof SqlExpression) {
            return `${k} = ${val.expr}`;
          }
          setParams.push(toSqlValueForColumn(k, val));
          return `${k} = ?`;
        });
        sql = `UPDATE ${this.table} SET ${assignments.join(", ")}`;
      } else {
        sql = `DELETE FROM ${this.table}`;
      }

      if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
      const params = [...setParams, ...whereParams];

      if (this.returningColumns) {
        const { columns: retCols } = normalizeColumns(this.returningColumns);
        sql += ` RETURNING ${retCols.join(", ")}`;
      }

      let resultRows: any[];
      if (this.returningColumns) {
        resultRows = db.prepare(sql).all(...params) as any[];
        resultRows = resultRows.map(parseJsonColumns);
      } else {
        db.prepare(sql).run(...params);
        resultRows = [];
      }

      const data = this.returningColumns ? resultRows : null;

      if (this.singleMode === "single") {
        if (!data || data.length === 0) {
          return { data: null, error: { message: "No rows", code: "PGRST116" } };
        }
        return { data: data[0], error: null };
      }
      if (this.singleMode === "maybeSingle") {
        return { data: data?.[0] || null, error: null };
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }

  // ── Execute router ────────────────────────────────────────────────────

  async execute(): Promise<QueryResult<any>> {
    // SQLite operations are synchronous, but we wrap in async for API compat
    if (this.operation === "select") return this.executeSelect();
    if (this.operation === "insert" || this.operation === "upsert") return this.executeInsertOrUpsert();
    return this.executeUpdateOrDelete();
  }
}

// ── JSON column parsing ─────────────────────────────────────────────────────

const KNOWN_JSON_COLUMNS = new Set([
  ...JSON_COLUMNS,
  "depends_on",
  "open_blockers",
  "swarm_models",
  "run_index",
  "stage_decisions",
  "definition",
  "metadata",
  "models",
  "config",
  "policy",
  "done_criteria",
  "outputs",
  "task_snapshot",
  "data_mapping",
]);

function parseJsonColumns(row: any): any {
  if (!row || typeof row !== "object") return row;
  const result = { ...row };
  for (const key of Object.keys(result)) {
    if (KNOWN_JSON_COLUMNS.has(key) && typeof result[key] === "string") {
      try {
        result[key] = JSON.parse(result[key]);
      } catch {
        // leave as string
      }
    }
    // SQLite stores booleans as 0/1; convert known boolean columns
    if (key === "swarm" || key === "is_default" || key === "is_public" || key === "had_graph_before") {
      if (result[key] === 0) result[key] = false;
      else if (result[key] === 1) result[key] = true;
    }
  }
  return result;
}

// ── Exported client factory ─────────────────────────────────────────────────

export function createAdminDbClientSQLite(): any {
  return {
    from(table: string) {
      return new SQLiteQueryBuilder(table);
    },
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: LOCAL_USER.id,
              email: LOCAL_USER.email,
              user_metadata: { name: LOCAL_USER.name, full_name: LOCAL_USER.name },
            },
          },
          error: null,
        };
      },
      async exchangeCodeForSession() {
        return { error: null };
      },
      async refreshSession() {
        return {
          data: {
            session: {
              access_token: "local-token",
              refresh_token: "local-refresh",
              expires_in: 3600,
            },
            user: { id: LOCAL_USER.id, email: LOCAL_USER.email },
          },
          error: null,
        };
      },
    },
    async rpc(fn: string, args: Record<string, any>) {
      if (fn !== "check_rate_limit") {
        return { data: null, error: { message: `Unsupported rpc: ${fn}` } };
      }

      const db = getSQLiteDb();
      const userId = args.p_user_id;
      const endpoint = args.p_endpoint;
      const limit = Number(args.p_limit || 60);
      const windowSeconds = Number(args.p_window_seconds || 60);
      const now = new Date();
      const bucket = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);

      try {
        const sql = `
          INSERT INTO rate_limits (user_id, endpoint, window_start, request_count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT (user_id, endpoint, window_start)
          DO UPDATE SET request_count = rate_limits.request_count + 1
          RETURNING request_count
        `;
        const row = db.prepare(sql).get(userId, endpoint, bucket.toISOString()) as any;
        const count = Number(row?.request_count || 0);
        return { data: count <= limit, error: null };
      } catch (error: any) {
        return { data: false, error };
      }
    },
    channel() {
      return {
        on() {
          return this;
        },
        subscribe(callback?: (status: string) => void) {
          if (callback) callback("SUBSCRIBED");
          return this;
        },
      };
    },
    removeChannel() {},
  };
}

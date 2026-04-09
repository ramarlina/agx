import type { DatabaseSync } from "node:sqlite";
import { pragmaAll, transaction } from "./sqlite-compat";
import { loadParticipants } from "@/lib/participants-store";
import { LOCAL_USER } from "@/lib/auth-mode";

export const WORKSPACES_TO_PROJECTS_MIGRATION_KEY = "legacy_workspaces_to_projects_v1";

interface LegacyTeamRow {
  id: string;
  name: string;
  user_id: string;
  is_default: number;
}

interface LegacyTeamAgentRow {
  team_id: string;
  agent_id: string;
  routing_order: number;
}

interface LegacyTeamWorkspaceRow {
  team_id: string;
  thread_id: string;
}

interface LegacyParticipant {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  color: string;
  identity?: string;
  skills?: Array<{ file: string; condition: string }>;
  variables?: Record<string, string>;
}

export interface WorkspacesToProjectsMigrationResult {
  usersProcessed: number;
  agentsImported: number;
  agentSkillsMigrated: number;
  projectsCreated: number;
  projectsMatched: number;
  projectAgentsLinked: number;
  projectThreadsLinked: number;
  projectVariablesMigrated: number;
  remappedThreadLinks: number;
  warnings: string[];
  projectMappings: Array<{
    teamId: string;
    teamName: string;
    projectId: string;
    projectName: string;
    threadIds: string[];
  }>;
}

export interface WorkspaceTeamTableState {
  legacyTeams: boolean;
  legacyTeamAgents: boolean;
  legacyTeamWorkspaces: boolean;
  projectScopedTeams: boolean;
  projectScopedTeamAgents: boolean;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName)
  );
}

function getTableColumnNames(db: DatabaseSync, tableName: string): Set<string> {
  if (!tableExists(db, tableName)) return new Set();
  const columns = pragmaAll(db, `table_info(${tableName})`) as { name: string }[];
  return new Set(columns.map((column) => column.name));
}

function countTableRows(db: DatabaseSync, tableName: string): number {
  if (!tableExists(db, tableName)) return 0;
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get() as { n: number }).n;
}

export function getWorkspaceTeamTableState(inputDb?: DatabaseSync): WorkspaceTeamTableState {
  if (!inputDb) {
    throw new Error("getWorkspaceTeamTableState requires an explicit database handle");
  }
  const db = inputDb;
  const teamColumns = getTableColumnNames(db, "teams");
  const teamAgentColumns = getTableColumnNames(db, "team_agents");
  const hasTeamWorkspaces = tableExists(db, "team_workspaces");

  const projectScopedTeams =
    teamColumns.has("project_id") &&
    teamColumns.has("template_id") &&
    teamColumns.has("metadata") &&
    !teamColumns.has("user_id");
  const legacyTeams =
    teamColumns.has("user_id") &&
    teamColumns.has("is_default") &&
    !teamColumns.has("project_id");

  const projectScopedTeamAgents =
    teamAgentColumns.has("team_id") &&
    teamAgentColumns.has("agent_id") &&
    teamAgentColumns.has("role_key");
  const legacyTeamAgents =
    teamAgentColumns.has("team_id") &&
    teamAgentColumns.has("agent_id") &&
    teamAgentColumns.has("routing_order") &&
    !teamAgentColumns.has("role_key");

  return {
    legacyTeams,
    legacyTeamAgents,
    legacyTeamWorkspaces: hasTeamWorkspaces,
    projectScopedTeams,
    projectScopedTeamAgents,
  };
}

export function hasLegacyWorkspaceTeamSchema(inputDb?: DatabaseSync): boolean {
  const state = getWorkspaceTeamTableState(inputDb);
  return state.legacyTeams || state.legacyTeamAgents || state.legacyTeamWorkspaces;
}

function hasCompleteLegacyWorkspaceTeamSchema(state: WorkspaceTeamTableState): boolean {
  return state.legacyTeams && state.legacyTeamAgents && state.legacyTeamWorkspaces;
}

export function getLegacyWorkspaceSourceCounts(inputDb?: DatabaseSync): {
  teams: number;
  teamAgents: number;
  teamWorkspaces: number;
} {
  if (!inputDb) {
    throw new Error("getLegacyWorkspaceSourceCounts requires an explicit database handle");
  }
  const db = inputDb;
  const state = getWorkspaceTeamTableState(db);

  return {
    teams: state.legacyTeams ? countTableRows(db, "teams") : 0,
    teamAgents: state.legacyTeamAgents ? countTableRows(db, "team_agents") : 0,
    teamWorkspaces: state.legacyTeamWorkspaces ? countTableRows(db, "team_workspaces") : 0,
  };
}

function ensureMigrationStateTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      metadata JSON
    );
  `);
}

function isMigrationApplied(db: DatabaseSync, key: string): boolean {
  ensureMigrationStateTable(db);
  const row = db
    .prepare("SELECT 1 FROM app_migrations WHERE key = ? LIMIT 1")
    .get(key) as { 1: number } | undefined;
  return Boolean(row);
}

function markMigrationApplied(
  db: DatabaseSync,
  key: string,
  metadata: Record<string, unknown>
) {
  ensureMigrationStateTable(db);
  db.prepare(
    `INSERT INTO app_migrations (key, metadata)
     VALUES (?, json(?))
     ON CONFLICT(key) DO UPDATE SET
       applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       metadata = excluded.metadata`
  ).run(key, JSON.stringify(metadata));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadLegacyState(db: DatabaseSync) {
  const teams = db
    .prepare("SELECT id, name, user_id, COALESCE(is_default, 0) AS is_default FROM teams ORDER BY name ASC")
    .all() as unknown as LegacyTeamRow[];
  const teamAgents = db
    .prepare("SELECT team_id, agent_id, routing_order FROM team_agents ORDER BY team_id, routing_order ASC")
    .all() as unknown as LegacyTeamAgentRow[];
  const teamWorkspaces = db
    .prepare("SELECT team_id, thread_id FROM team_workspaces ORDER BY team_id, thread_id ASC")
    .all() as unknown as LegacyTeamWorkspaceRow[];

  return { teams, teamAgents, teamWorkspaces };
}

function ensureProject(
  db: DatabaseSync,
  userId: string,
  team: LegacyTeamRow,
  result: WorkspacesToProjectsMigrationResult
): { id: string; name: string } {
  const explicitSlug = team.is_default ? "default" : slugify(team.name);
  const existingBySlug = db
    .prepare("SELECT id, name FROM projects WHERE user_id = ? AND slug = ? LIMIT 1")
    .get(userId, explicitSlug) as { id: string; name: string } | undefined;
  if (existingBySlug) {
    result.projectsMatched++;
    return existingBySlug;
  }

  const fallbackName = team.is_default ? "Default Project" : titleCase(team.name);
  const created = db
    .prepare(
      `INSERT INTO projects (user_id, name, slug, description)
       VALUES (?, ?, ?, ?)
       RETURNING id, name`
    )
    .get(
      userId,
      fallbackName,
      explicitSlug || `project-${team.id.slice(0, 8)}`,
      "Migrated from legacy workspace/team structure"
    ) as { id: string; name: string };
  result.projectsCreated++;
  return created;
}

function importLegacyParticipants(
  db: DatabaseSync,
  userId: string,
  participants: LegacyParticipant[],
  result: WorkspacesToProjectsMigrationResult
) {
  const insert = db.prepare(
    `INSERT INTO agents (id, user_id, name, style, description, model, provider, color, voice, seed)
     VALUES (?, ?, ?, 'balanced', ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       name = excluded.name,
       description = COALESCE(NULLIF(excluded.description, ''), agents.description),
       model = COALESCE(NULLIF(excluded.model, ''), agents.model),
       provider = COALESCE(NULLIF(excluded.provider, ''), agents.provider),
       color = COALESCE(NULLIF(excluded.color, ''), agents.color),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  );

  const exists = db.prepare("SELECT 1 FROM agents WHERE id = ?");

  for (const participant of participants) {
    const hadAgent = Boolean(exists.get(participant.id));
    insert.run(
      participant.id,
      userId,
      participant.name,
      participant.identity ?? null,
      participant.model ?? null,
      participant.provider ?? "claude",
      participant.color ?? "#6B7280"
    );
    if (!hadAgent) {
      result.agentsImported++;
    }
  }
}

function migrateProjectResources(
  db: DatabaseSync,
  projectId: string,
  agentIds: string[],
  participantById: Map<string, LegacyParticipant>,
  result: WorkspacesToProjectsMigrationResult
) {
  const insertVariable = db.prepare(
    `INSERT INTO project_variables (project_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`
  );
  const existingVariable = db.prepare(
    "SELECT value FROM project_variables WHERE project_id = ? AND key = ?"
  );

  for (const agentId of agentIds) {
    const participant = participantById.get(agentId);
    if (!participant) continue;

    for (const [key, value] of Object.entries(participant.variables ?? {})) {
      const current = existingVariable.get(projectId, key) as { value: string } | undefined;
      if (current && current.value !== value) {
        result.warnings.push(
          `Variable conflict for project ${projectId}: key "${key}" kept existing value "${current.value}" over "${value}"`
        );
        continue;
      }
      const info = insertVariable.run(projectId, key, value);
      if (!current && info.changes > 0) result.projectVariablesMigrated++;
    }
  }
}

function migrateAgentSkills(
  db: DatabaseSync,
  participants: LegacyParticipant[],
  result: WorkspacesToProjectsMigrationResult
) {
  const insertSkill = db.prepare(
    `INSERT INTO agent_skills (agent_id, file, condition)
     VALUES (?, ?, ?)
     ON CONFLICT(agent_id, file) DO UPDATE SET
       condition = excluded.condition`
  );

  for (const participant of participants) {
    for (const skill of participant.skills ?? []) {
      const file = skill.file?.trim();
      if (!file) continue;
      const existing = db
        .prepare("SELECT condition FROM agent_skills WHERE agent_id = ? AND file = ?")
        .get(participant.id, file) as { condition: string | null } | undefined;
      const nextCondition = skill.condition || null;
      insertSkill.run(participant.id, file, nextCondition);
      if (!existing || existing.condition !== nextCondition) {
        result.agentSkillsMigrated++;
      }
    }
  }
}

export function migrateLegacyWorkspacesToProjects(
  inputDb?: DatabaseSync
): WorkspacesToProjectsMigrationResult {
  if (!inputDb) {
    throw new Error("migrateLegacyWorkspacesToProjects requires an explicit database handle");
  }
  const db = inputDb;
  const result: WorkspacesToProjectsMigrationResult = {
    usersProcessed: 0,
    agentsImported: 0,
    agentSkillsMigrated: 0,
    projectsCreated: 0,
    projectsMatched: 0,
    projectAgentsLinked: 0,
    projectThreadsLinked: 0,
    projectVariablesMigrated: 0,
    remappedThreadLinks: 0,
    warnings: [],
    projectMappings: [],
  };

  const teamTableState = getWorkspaceTeamTableState(db);
  if (!hasLegacyWorkspaceTeamSchema(db)) {
    result.warnings.push("No legacy workspace/team tables found.");
    return result;
  }
  if (!hasCompleteLegacyWorkspaceTeamSchema(teamTableState)) {
    result.warnings.push("Legacy workspace/team schema is incomplete; refusing to auto-migrate partial tables.");
    return result;
  }

  const participants = loadParticipants() as unknown as LegacyParticipant[];
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  const { teams, teamAgents, teamWorkspaces } = loadLegacyState(db);
  const teamsByUser = new Map<string, LegacyTeamRow[]>();
  for (const team of teams) {
    const list = teamsByUser.get(team.user_id) ?? [];
    list.push(team);
    teamsByUser.set(team.user_id, list);
  }

  const teamAgentsByTeam = new Map<string, LegacyTeamAgentRow[]>();
  for (const row of teamAgents) {
    const list = teamAgentsByTeam.get(row.team_id) ?? [];
    list.push(row);
    teamAgentsByTeam.set(row.team_id, list);
  }

  const workspacesByTeam = new Map<string, string[]>();
  for (const row of teamWorkspaces) {
    const list = workspacesByTeam.get(row.team_id) ?? [];
    list.push(row.thread_id);
    workspacesByTeam.set(row.team_id, list);
  }

  const migrateTxn = () => transaction(db, () => {
    for (const [userId, userTeams] of teamsByUser.entries()) {
      result.usersProcessed++;
      const effectiveUserId = userId || LOCAL_USER.id;
      importLegacyParticipants(db, effectiveUserId, participants, result);
      migrateAgentSkills(db, participants, result);

      const intendedAgentsByProject = new Map<string, Array<{ agent_id: string; routing_order: number }>>();
      const intendedThreadsByProject = new Map<string, string[]>();

      for (const team of userTeams) {
        const workspaceIds = workspacesByTeam.get(team.id) ?? [];
        const project = ensureProject(db, effectiveUserId, team, result);

        const agentRows = teamAgentsByTeam.get(team.id) ?? [];
        intendedAgentsByProject.set(project.id, agentRows);
        intendedThreadsByProject.set(project.id, workspaceIds);

        result.projectMappings.push({
          teamId: team.id,
          teamName: team.name,
          projectId: project.id,
          projectName: project.name,
          threadIds: workspaceIds,
        });
      }

      const insertProjectAgent = db.prepare(
        `INSERT INTO project_agents (project_id, agent_id, routing_order)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id, agent_id) DO UPDATE SET
           routing_order = excluded.routing_order`
      );
      const deleteThreadLinksElsewhere = db.prepare(
        "DELETE FROM project_threads WHERE thread_id = ? AND project_id <> ?"
      );
      const insertProjectThread = db.prepare(
        `INSERT OR IGNORE INTO project_threads (project_id, thread_id)
         VALUES (?, ?)`
      );

      for (const [projectId, agentRows] of intendedAgentsByProject.entries()) {
        for (const row of agentRows) {
          const linked = insertProjectAgent.run(projectId, row.agent_id, row.routing_order);
          if (linked.changes > 0) result.projectAgentsLinked++;
        }

        migrateProjectResources(
          db,
          projectId,
          agentRows.map((row) => row.agent_id),
          participantById,
          result
        );
      }

      for (const [projectId, threadIds] of intendedThreadsByProject.entries()) {
        for (const threadId of threadIds) {
          const removed = deleteThreadLinksElsewhere.run(threadId, projectId);
          result.remappedThreadLinks += Number(removed.changes);
          const linked = insertProjectThread.run(projectId, threadId);
          if (linked.changes > 0) result.projectThreadsLinked++;
        }
      }
    }
  });

  migrateTxn();
  return result;
}

export function autoMigrateLegacyWorkspacesToProjects(
  inputDb?: DatabaseSync
): WorkspacesToProjectsMigrationResult | null {
  if (!inputDb) {
    throw new Error("autoMigrateLegacyWorkspacesToProjects requires an explicit database handle");
  }
  const db = inputDb;
  const teamTableState = getWorkspaceTeamTableState(db);
  if (!hasLegacyWorkspaceTeamSchema(db)) {
    return null;
  }
  if (!hasCompleteLegacyWorkspaceTeamSchema(teamTableState)) {
    return null;
  }

  if (isMigrationApplied(db, WORKSPACES_TO_PROJECTS_MIGRATION_KEY)) {
    return null;
  }

  const result = migrateLegacyWorkspacesToProjects(db);
  markMigrationApplied(db, WORKSPACES_TO_PROJECTS_MIGRATION_KEY, {
    usersProcessed: result.usersProcessed,
    agentsImported: result.agentsImported,
    agentSkillsMigrated: result.agentSkillsMigrated,
    projectsCreated: result.projectsCreated,
    projectsMatched: result.projectsMatched,
    projectAgentsLinked: result.projectAgentsLinked,
    projectThreadsLinked: result.projectThreadsLinked,
    projectVariablesMigrated: result.projectVariablesMigrated,
    remappedThreadLinks: result.remappedThreadLinks,
    warnings: result.warnings,
  });
  return result;
}

export function getLegacyWorkspaceMigrationStatus(inputDb?: DatabaseSync): {
  applied: boolean;
  appliedAt: string | null;
  metadata: Record<string, unknown> | null;
} {
  if (!inputDb) {
    throw new Error("getLegacyWorkspaceMigrationStatus requires an explicit database handle");
  }
  const db = inputDb;
  ensureMigrationStateTable(db);
  const row = db
    .prepare("SELECT applied_at, metadata FROM app_migrations WHERE key = ? LIMIT 1")
    .get(WORKSPACES_TO_PROJECTS_MIGRATION_KEY) as { applied_at: string; metadata: string | null } | undefined;

  if (!row) {
    return { applied: false, appliedAt: null, metadata: null };
  }

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }

  return {
    applied: true,
    appliedAt: row.applied_at,
    metadata,
  };
}

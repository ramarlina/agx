/**
 * SQLiteAdapter – wraps db.ts functions for the SQLite backend.
 *
 * When DB_BACKEND=sqlite, the QueryBuilder in db-adapter.ts delegates to
 * sqlite-query-adapter.ts, so the same db.ts functions work unchanged.
 * This adapter class implements DbAdapter and provides SQLite-specific
 * transaction support.
 */

import type { DbAdapter, TransactionClient } from "../db-adapter.interface";
import type {
  Task,
  TaskStatus,
  TaskStage,
  RunIndexEntry,
  SwarmModel,
  TaskLog,
  TaskComment,
  TaskCostEntry,
  Project,
  ProjectWithRepos,
  ProjectRepo,
  ProjectInput,
  ProjectUpdatePayload,
  Workflow,
  WorkflowNode,
  WorkflowTransition,
  WorkflowWithGraph,
  Learning,
  LearningScope,
  StagePrompt,
  Agent,
  AgentStyle,
  UserSettings,
  UserSettingsProvenance,
  TaskCostSummary,
  ProjectAgent,
  ProjectSkill,
  ProjectVariable,
  ProjectMemory,
  ProjectThread,
} from "../db";

import * as db from "../db";
import { getSQLiteDb, sqlExpr } from "../sqlite-query-adapter";
import { ConcurrentModificationError, ConflictError, RetryableError } from "../errors";

/**
 * Translate SQLite-specific errors into app-level error types so the
 * application layer sees consistent errors regardless of adapter.
 */
function translateSqliteError(err: unknown): never {
  if (!(err instanceof Error)) throw err;

  const sqliteErr = err as Error & { code?: string; message: string };
  const code = sqliteErr.code ?? "";
  const msg = sqliteErr.message ?? "";

  // UNIQUE / PRIMARY KEY constraint violation → ConflictError
  // PG reports both as code 23505 (unique_violation); SQLite distinguishes them
  if (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    (code === "SQLITE_CONSTRAINT" && (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY"))) ||
    msg.includes("UNIQUE constraint failed") ||
    msg.includes("PRIMARY KEY constraint failed")
  ) {
    const constraintMatch = msg.match(/(?:UNIQUE|PRIMARY KEY) constraint failed: (.+)/);
    throw new ConflictError(msg, {
      constraint: constraintMatch?.[1],
      detail: msg,
    });
  }

  // Database busy/locked → RetryableError
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    msg.includes("database is locked")
  ) {
    throw new RetryableError(msg, code || "SQLITE_BUSY");
  }

  throw err;
}

/**
 * Wrap an async function with SQLite error translation.
 */
async function withErrorTranslation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Don't re-translate errors that are already app-level types
    if (
      err instanceof ConflictError ||
      err instanceof RetryableError ||
      err instanceof ConcurrentModificationError
    ) {
      throw err;
    }
    translateSqliteError(err);
  }
}

export class SQLiteAdapter implements DbAdapter {
  // ── Transactions ──────────────────────────────────────────────────────

  async transaction<T>(fn: (client: TransactionClient) => Promise<T>): Promise<T> {
    const sqliteDb = getSQLiteDb();
    sqliteDb.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(sqliteDb as any);
      sqliteDb.exec("COMMIT");
      return result;
    } catch (err) {
      try { sqliteDb.exec("ROLLBACK"); } catch { /* already rolled back */ }
      // Don't re-translate app-level errors
      if (
        err instanceof ConflictError ||
        err instanceof RetryableError ||
        err instanceof ConcurrentModificationError
      ) {
        throw err;
      }
      translateSqliteError(err);
    }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────

  getTasks(
    userId?: string,
    filters?: { project?: string; status?: TaskStatus; search?: string; orphan?: boolean },
  ): Promise<Task[]> {
    return db.getTasks(userId, filters);
  }

  getTask(id: string, userId?: string): Promise<Task | null> {
    return db.getTask(id, userId);
  }

  getTaskBySlug(slug: string, userId?: string): Promise<Task | null> {
    return db.getTaskBySlug(slug, userId);
  }

  createTask(
    content: string,
    userId?: string,
    options?: {
      swarmModels?: SwarmModel[] | null;
      currentPlan?: string;
      openBlockers?: string[];
      nextAction?: string;
      dependsOn?: string[] | null;
      projectId?: string;
      title?: string;
    },
  ): Promise<Task> {
    return withErrorTranslation(() => db.createTask(content, userId, options));
  }

  async updateTask(
    id: string,
    content: string,
    userId?: string,
    options?: {
      swarmModels?: SwarmModel[] | null;
      currentPlan?: string;
      openBlockers?: string[];
      nextAction?: string;
      expectedVersion?: number;
      dependsOn?: string[] | null;
    },
  ): Promise<Task> {
    const expectedVersion = options?.expectedVersion;

    if (expectedVersion !== undefined) {
      // Application-level CAS: atomically increment version only if it
      // matches the expected value.  We run a single UPDATE ... WHERE
      // version = ? and inspect changes() to detect conflicts.
      const sqliteDb = getSQLiteDb();
      const result = sqliteDb
        .prepare(
          `UPDATE tasks SET version = version + 1 WHERE id = ? AND version = ?`,
        )
        .run(id, expectedVersion);

      if (result.changes === 0) {
        // Either the row doesn't exist or the version diverged.
        const row = sqliteDb
          .prepare(`SELECT version FROM tasks WHERE id = ?`)
          .get(id) as { version: number } | undefined;

        throw new ConcurrentModificationError(
          "task",
          id,
          expectedVersion,
          row?.version,
        );
      }

      // Version has been bumped atomically.  Delegate to db.updateTask
      // *without* expectedVersion so it doesn't try its own (non-atomic)
      // check, and the version column won't be overwritten because
      // db.updateTask only sets version via the (unsupported) rpc call
      // which is a no-op on SQLite.
      const { expectedVersion: _ev, ...rest } = options ?? {};
      return withErrorTranslation(() => db.updateTask(id, content, userId, rest));
    }

    // No CAS requested — still bump version for consistency.
    const sqliteDb = getSQLiteDb();
    sqliteDb
      .prepare(`UPDATE tasks SET version = version + 1 WHERE id = ?`)
      .run(id);

    return withErrorTranslation(() => db.updateTask(id, content, userId, options));
  }

  appendRunToIndex(taskId: string, runEntry: RunIndexEntry, maxRuns?: number): Promise<void> {
    return db.appendRunToIndex(taskId, runEntry, maxRuns);
  }

  deleteTask(id: string, userId?: string): Promise<void> {
    return withErrorTranslation(() => db.deleteTask(id, userId));
  }

  getNextQueuedTask(engine?: string): Promise<Task | null> {
    return db.getNextQueuedTask(engine);
  }

  ensureNoCircularDependency(
    taskId: string,
    dependsOn: string[],
    client?: TransactionClient,
  ): Promise<void> {
    return db.ensureNoCircularDependency(taskId, dependsOn, client);
  }

  // ── Projects ──────────────────────────────────────────────────────────

  getProjects(userId?: string, includeArchived?: boolean): Promise<ProjectWithRepos[]> {
    return db.getProjects(userId, includeArchived);
  }

  getProjectBySlug(slug: string, userId?: string): Promise<Project | null> {
    return db.getProjectBySlug(slug, userId);
  }

  getProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return db.getProjectRepos(projectId);
  }

  getProjectWithRepos(projectIdOrSlug: string, userId?: string): Promise<ProjectWithRepos | null> {
    return db.getProjectWithRepos(projectIdOrSlug, userId);
  }

  createProject(userId: string, input: ProjectInput, client?: TransactionClient): Promise<ProjectWithRepos> {
    return withErrorTranslation(() => db.createProject(userId, input, client));
  }

  updateProject(
    projectIdOrSlug: string,
    userId: string,
    updates: ProjectUpdatePayload,
    client?: TransactionClient,
  ): Promise<ProjectWithRepos | null> {
    return db.updateProject(projectIdOrSlug, userId, updates, client);
  }

  deleteProject(projectId: string, userId: string, client?: TransactionClient): Promise<void> {
    return withErrorTranslation(() => db.deleteProject(projectId, userId, client));
  }

  assignOrphanTasksToProject(
    projectId: string,
    userId: string,
    client?: TransactionClient,
  ): Promise<{ updatedCount: number; taskIds: string[] }> {
    return db.assignOrphanTasksToProject(projectId, userId, client);
  }

  // ── Workflows ─────────────────────────────────────────────────────────

  getWorkflows(userId: string): Promise<Workflow[]> {
    return db.getWorkflows(userId);
  }

  getWorkflow(id: string, userId?: string): Promise<Workflow | null> {
    return db.getWorkflow(id, userId);
  }

  updateWorkflow(
    id: string,
    userId: string,
    updates: { definition?: Record<string, unknown>; name?: string; description?: string },
  ): Promise<Workflow | null> {
    return db.updateWorkflow(id, userId, updates);
  }

  getWorkflowNodes(workflowId: string): Promise<WorkflowNode[]> {
    return db.getWorkflowNodes(workflowId);
  }

  updateWorkflowNodes(
    workflowId: string,
    userId: string,
    updates: Array<{
      id: string;
      prompt?: string;
      provider?: string;
      model?: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<WorkflowNode[]> {
    return db.updateWorkflowNodes(workflowId, userId, updates);
  }

  getWorkflowNodeByName(workflowId: string, name: string): Promise<WorkflowNode | null> {
    return db.getWorkflowNodeByName(workflowId, name);
  }

  getWorkflowTransitions(workflowId: string): Promise<WorkflowTransition[]> {
    return db.getWorkflowTransitions(workflowId);
  }

  getWorkflowTransitionsFromNode(
    workflowId: string,
    fromNodeId: string,
  ): Promise<WorkflowTransition[]> {
    return db.getWorkflowTransitionsFromNode(workflowId, fromNodeId);
  }

  getWorkflowWithGraph(id: string, userId?: string): Promise<WorkflowWithGraph | null> {
    return db.getWorkflowWithGraph(id, userId);
  }

  // ── Task Logs ─────────────────────────────────────────────────────────

  getTaskLogs(
    taskId: string,
    options?: { limit?: number; tail?: number; after?: string; nodeId?: string },
  ): Promise<TaskLog[]> {
    return db.getTaskLogs(taskId, options);
  }

  addTaskLog(taskId: string, content: string, logType?: string, nodeId?: string): Promise<TaskLog> {
    return withErrorTranslation(() => db.addTaskLog(taskId, content, logType, nodeId));
  }

  // ── Task Costs ────────────────────────────────────────────────────────

  addTaskCostEntry(input: {
    taskId: string;
    stage: string;
    provider?: string | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  }): Promise<TaskCostEntry> {
    return withErrorTranslation(() => db.addTaskCostEntry(input));
  }

  getTaskCostEntries(taskId: string): Promise<TaskCostEntry[]> {
    return db.getTaskCostEntries(taskId);
  }

  getTaskCostSummary(taskId: string): Promise<TaskCostSummary> {
    return db.getTaskCostSummary(taskId);
  }

  // ── Task Comments ─────────────────────────────────────────────────────

  getTaskComments(taskId: string): Promise<TaskComment[]> {
    return db.getTaskComments(taskId);
  }

  addTaskComment(
    taskId: string,
    content: string,
    authorType: "user" | "agent",
    authorId?: string,
  ): Promise<TaskComment> {
    return withErrorTranslation(() => db.addTaskComment(taskId, content, authorType, authorId));
  }

  deleteTaskComment(commentId: string, userId: string): Promise<void> {
    return withErrorTranslation(() => db.deleteTaskComment(commentId, userId));
  }

  // ── Learnings ─────────────────────────────────────────────────────────

  getLearnings(scope: LearningScope, scopeId?: string, userId?: string): Promise<Learning[]> {
    return db.getLearnings(scope, scopeId, userId);
  }

  addLearning(
    scope: LearningScope,
    content: string,
    scopeId?: string,
    userId?: string,
  ): Promise<Learning> {
    return withErrorTranslation(() => db.addLearning(scope, content, scopeId, userId));
  }

  deleteLearning(id: string, userId?: string): Promise<void> {
    return withErrorTranslation(() => db.deleteLearning(id, userId));
  }

  // ── Stage Prompts ─────────────────────────────────────────────────────

  getStagePrompts(userId: string | undefined, workflowId: string): Promise<StagePrompt[]> {
    return db.getStagePrompts(userId, workflowId);
  }

  getStagePrompt(
    stage: TaskStage,
    userId: string | undefined,
    workflowId: string,
  ): Promise<StagePrompt | null> {
    return db.getStagePrompt(stage, userId, workflowId);
  }

  upsertStagePrompt(
    stage: TaskStage,
    prompt: string,
    outputs: string[],
    userId: string | undefined,
    modelConfig:
      | { swarm?: boolean; provider?: string; model?: string; swarm_models?: SwarmModel[] }
      | undefined,
    workflowId: string,
  ): Promise<StagePrompt> {
    return withErrorTranslation(() => db.upsertStagePrompt(stage, prompt, outputs, userId, modelConfig, workflowId));
  }

  deleteStagePrompt(id: string, userId?: string): Promise<void> {
    return db.deleteStagePrompt(id, userId);
  }

  // ── Agents ────────────────────────────────────────────────────────────

  getAgents(userId: string): Promise<Agent[]> {
    return db.getAgents(userId);
  }

  getAgent(id: string, userId: string): Promise<Agent | null> {
    return db.getAgent(id, userId);
  }

  createAgent(
    userId: string,
    input: {
      id?: string;
      name: string;
      style: AgentStyle;
      description?: string;
      config?: Record<string, unknown>;
      voice?: string;
      seed?: string;
      model?: string;
      provider?: string;
      color?: string;
    },
  ): Promise<Agent> {
    return withErrorTranslation(() => db.createAgent(userId, input));
  }

  updateAgent(
    id: string,
    userId: string,
    input: {
      name?: string;
      style?: AgentStyle;
      description?: string;
      config?: Record<string, unknown>;
      voice?: string;
      seed?: string;
      model?: string;
      provider?: string;
      color?: string;
    },
  ): Promise<Agent | null> {
    return db.updateAgent(id, userId, input);
  }

  deleteAgent(id: string, userId: string): Promise<void> {
    return db.deleteAgent(id, userId);
  }

  // ── Project Agents ──────────────────────────────────────────────────────

  getProjectAgents(projectId: string): Promise<ProjectAgent[]> {
    return db.getProjectAgents(projectId);
  }

  addProjectAgent(projectId: string, agentId: string, routingOrder?: number): Promise<ProjectAgent> {
    return withErrorTranslation(() => db.addProjectAgent(projectId, agentId, routingOrder));
  }

  removeProjectAgent(projectId: string, agentId: string): Promise<void> {
    return db.removeProjectAgent(projectId, agentId);
  }

  reorderProjectAgents(projectId: string, orderedAgentIds: string[]): Promise<ProjectAgent[]> {
    return db.reorderProjectAgents(projectId, orderedAgentIds);
  }

  // ── Teams ──────────────────────────────────────────────────────────────

  getTeams(projectId: string) {
    return db.getTeams(projectId);
  }

  getTeam(teamId: string) {
    return db.getTeam(teamId);
  }

  createTeam(projectId: string, name: string, templateId?: string, metadata?: Record<string, unknown>) {
    return withErrorTranslation(() => db.createTeam(projectId, name, templateId, metadata));
  }

  updateTeam(teamId: string, updates: { name?: string; metadata?: Record<string, unknown> }) {
    return db.updateTeam(teamId, updates);
  }

  deleteTeam(teamId: string) {
    return db.deleteTeam(teamId);
  }

  getTeamAgents(teamId: string) {
    return db.getTeamAgents(teamId);
  }

  addTeamAgent(teamId: string, agentId: string, roleKey: string, routingOrder?: number) {
    return withErrorTranslation(() => db.addTeamAgent(teamId, agentId, roleKey, routingOrder));
  }

  removeTeamAgent(teamId: string, agentId: string) {
    return db.removeTeamAgent(teamId, agentId);
  }

  // ── Project Skills ──────────────────────────────────────────────────────

  getProjectSkills(projectId: string): Promise<ProjectSkill[]> {
    return db.getProjectSkills(projectId);
  }

  addProjectSkill(projectId: string, file: string, condition?: string): Promise<ProjectSkill> {
    return withErrorTranslation(() => db.addProjectSkill(projectId, file, condition));
  }

  removeProjectSkill(skillId: string): Promise<void> {
    return db.removeProjectSkill(skillId);
  }

  // ── Project Variables ───────────────────────────────────────────────────

  getProjectVariables(projectId: string): Promise<ProjectVariable[]> {
    return db.getProjectVariables(projectId);
  }

  setProjectVariable(projectId: string, key: string, value: string): Promise<ProjectVariable> {
    return withErrorTranslation(() => db.setProjectVariable(projectId, key, value));
  }

  deleteProjectVariable(projectId: string, key: string): Promise<void> {
    return db.deleteProjectVariable(projectId, key);
  }

  // ── Project Memory ──────────────────────────────────────────────────────

  getProjectMemory(projectId: string, producer?: "human" | "system"): Promise<ProjectMemory[]> {
    return db.getProjectMemory(projectId, producer);
  }

  addProjectMemory(
    projectId: string,
    content: string,
    source?: string,
    producer?: "human" | "system"
  ): Promise<ProjectMemory> {
    return withErrorTranslation(() => db.addProjectMemory(projectId, content, source, producer));
  }

  deleteProjectMemory(memoryId: string): Promise<void> {
    return db.deleteProjectMemory(memoryId);
  }

  // ── Project Threads ─────────────────────────────────────────────────────

  getProjectThreads(projectId: string): Promise<ProjectThread[]> {
    return db.getProjectThreads(projectId);
  }

  addProjectThread(projectId: string, threadId: string): Promise<ProjectThread> {
    return withErrorTranslation(() => db.addProjectThread(projectId, threadId));
  }

  removeProjectThread(projectId: string, threadId: string): Promise<void> {
    return db.removeProjectThread(projectId, threadId);
  }

  getProjectForThread(threadId: string): Promise<string | null> {
    return db.getProjectForThread(threadId);
  }

  // ── User Settings ─────────────────────────────────────────────────────

  getUserSettings(userId: string): Promise<UserSettings | null> {
    return db.getUserSettings(userId);
  }

  upsertUserSettings(
    userId: string,
    input: {
      default_provider?: string | null;
      models?: Record<string, string> | null;
      provenance: UserSettingsProvenance;
      changed_at?: string | null;
    },
    options?: { onlyIfNewer?: boolean },
  ): Promise<{ settings: UserSettings; updated: boolean }> {
    return withErrorTranslation(() => db.upsertUserSettings(userId, input, options));
  }

  // ── Health ───────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ adapter: string; connected: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      const sqliteDb = getSQLiteDb();
      sqliteDb.prepare("SELECT 1").get();
      return { adapter: "sqlite", connected: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { adapter: "sqlite", connected: false, latencyMs: Math.round(performance.now() - start) };
    }
  }
}

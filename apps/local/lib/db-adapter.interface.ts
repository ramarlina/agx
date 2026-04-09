/**
 * DbAdapter – driver-agnostic interface for all agx-cloud database operations.
 *
 * Every function in lib/db.ts that touches the database has a corresponding
 * method here, grouped by domain.  Pure helpers (parseFrontmatter, extractTitle,
 * resolveTaskConfig, summarizeTaskCosts, etc.) live outside this interface.
 */

// ── Re-exported domain types (driver-agnostic) ─────────────────────────────

export type {
  Task,
  TaskStatus,
  TaskStage,
  TaskDependencySummary,
  TaskRunHistory,
  RunIndexEntry,
  ArtifactRef,
  SwarmModel,
  TaskLog,
  TaskComment,
  TaskCostEntry,
  TaskCostStageSummary,
  TaskCostSummary,
  Project,
  ProjectWithRepos,
  ProjectRepo,
  ProjectRepoInput,
  ProjectInput,
  ProjectUpdatePayload,
  Workflow,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTransition,
  WorkflowTransitionCondition,
  WorkflowWithGraph,
  Learning,
  LearningScope,
  StagePrompt,
  Agent,
  AgentStyle,
  UserSettings,
  UserSettingsProvenance,
  ProjectAgent,
  ProjectSkill,
  ProjectVariable,
  ProjectMemory,
  ProjectThread,
  SkillProvenance,
  MemoryProvenance,
  ExecutionProvenance,
} from "./db";

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
  ProjectAgent,
  ProjectSkill,
  ProjectVariable,
  ProjectMemory,
  ProjectThread,
} from "./db";

// ── Transaction abstraction ─────────────────────────────────────────────────

/**
 * Opaque client handle passed into transaction callbacks.
 * Drivers supply their own concrete type (e.g. pg PoolClient, node:sqlite DatabaseSync).
 */
export type TransactionClient = unknown;

// ── DbAdapter interface ─────────────────────────────────────────────────────

export interface DbAdapter {
  // ── Transactions ──────────────────────────────────────────────────────

  transaction<T>(fn: (client: TransactionClient) => Promise<T>): Promise<T>;

  // ── Tasks ─────────────────────────────────────────────────────────────

  getTasks(
    userId?: string,
    filters?: { project?: string; status?: TaskStatus; search?: string; orphan?: boolean },
  ): Promise<Task[]>;

  getTask(id: string, userId?: string): Promise<Task | null>;

  getTaskBySlug(slug: string, userId?: string): Promise<Task | null>;

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
  ): Promise<Task>;

  updateTask(
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
  ): Promise<Task>;

  appendRunToIndex(taskId: string, runEntry: RunIndexEntry, maxRuns?: number): Promise<void>;

  deleteTask(id: string, userId?: string): Promise<void>;

  getNextQueuedTask(engine?: string): Promise<Task | null>;

  ensureNoCircularDependency(
    taskId: string,
    dependsOn: string[],
    client?: TransactionClient,
  ): Promise<void>;

  // ── Projects ──────────────────────────────────────────────────────────

  getProjects(userId?: string, includeArchived?: boolean): Promise<ProjectWithRepos[]>;

  getProjectBySlug(slug: string, userId?: string): Promise<Project | null>;

  getProjectRepos(projectId: string): Promise<ProjectRepo[]>;

  getProjectWithRepos(projectIdOrSlug: string, userId?: string): Promise<ProjectWithRepos | null>;

  createProject(userId: string, input: ProjectInput, client?: TransactionClient): Promise<ProjectWithRepos>;

  updateProject(
    projectIdOrSlug: string,
    userId: string,
    updates: ProjectUpdatePayload,
    client?: TransactionClient,
  ): Promise<ProjectWithRepos | null>;

  deleteProject(projectId: string, userId: string, client?: TransactionClient): Promise<void>;

  assignOrphanTasksToProject(
    projectId: string,
    userId: string,
    client?: TransactionClient,
  ): Promise<{ updatedCount: number; taskIds: string[] }>;

  // ── Workflows ─────────────────────────────────────────────────────────

  getWorkflows(userId: string): Promise<Workflow[]>;

  getWorkflow(id: string, userId?: string): Promise<Workflow | null>;

  updateWorkflow(
    id: string,
    userId: string,
    updates: { definition?: Record<string, unknown>; name?: string; description?: string },
  ): Promise<Workflow | null>;

  getWorkflowNodes(workflowId: string): Promise<WorkflowNode[]>;

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
  ): Promise<WorkflowNode[]>;

  getWorkflowNodeByName(workflowId: string, name: string): Promise<WorkflowNode | null>;

  getWorkflowTransitions(workflowId: string): Promise<WorkflowTransition[]>;

  getWorkflowTransitionsFromNode(
    workflowId: string,
    fromNodeId: string,
  ): Promise<WorkflowTransition[]>;

  getWorkflowWithGraph(id: string, userId?: string): Promise<WorkflowWithGraph | null>;

  // ── Task Logs ─────────────────────────────────────────────────────────

  getTaskLogs(
    taskId: string,
    options?: { limit?: number; tail?: number; after?: string; nodeId?: string },
  ): Promise<TaskLog[]>;

  addTaskLog(taskId: string, content: string, logType?: string, nodeId?: string): Promise<TaskLog>;

  // ── Task Costs ────────────────────────────────────────────────────────

  addTaskCostEntry(input: {
    taskId: string;
    stage: string;
    provider?: string | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  }): Promise<TaskCostEntry>;

  getTaskCostEntries(taskId: string): Promise<TaskCostEntry[]>;

  getTaskCostSummary(taskId: string): Promise<import("./db").TaskCostSummary>;

  // ── Task Comments ─────────────────────────────────────────────────────

  getTaskComments(taskId: string): Promise<TaskComment[]>;

  addTaskComment(
    taskId: string,
    content: string,
    authorType: "user" | "agent",
    authorId?: string,
  ): Promise<TaskComment>;

  deleteTaskComment(commentId: string, userId: string): Promise<void>;

  // ── Learnings ─────────────────────────────────────────────────────────

  getLearnings(scope: LearningScope, scopeId?: string, userId?: string): Promise<Learning[]>;

  addLearning(
    scope: LearningScope,
    content: string,
    scopeId?: string,
    userId?: string,
  ): Promise<Learning>;

  deleteLearning(id: string, userId?: string): Promise<void>;

  // ── Stage Prompts ─────────────────────────────────────────────────────

  getStagePrompts(userId: string | undefined, workflowId: string): Promise<StagePrompt[]>;

  getStagePrompt(
    stage: TaskStage,
    userId: string | undefined,
    workflowId: string,
  ): Promise<StagePrompt | null>;

  upsertStagePrompt(
    stage: TaskStage,
    prompt: string,
    outputs: string[],
    userId: string | undefined,
    modelConfig:
      | { swarm?: boolean; provider?: string; model?: string; swarm_models?: SwarmModel[] }
      | undefined,
    workflowId: string,
  ): Promise<StagePrompt>;

  deleteStagePrompt(id: string, userId?: string): Promise<void>;

  // ── Agents ────────────────────────────────────────────────────────────

  getAgents(userId: string): Promise<Agent[]>;

  getAgent(id: string, userId: string): Promise<Agent | null>;

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
  ): Promise<Agent>;

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
  ): Promise<Agent | null>;

  deleteAgent(id: string, userId: string): Promise<void>;

  // ── Project Agents ─────────────────────────────────────────────────────

  getProjectAgents(projectId: string): Promise<ProjectAgent[]>;

  addProjectAgent(projectId: string, agentId: string, routingOrder?: number): Promise<ProjectAgent>;

  removeProjectAgent(projectId: string, agentId: string): Promise<void>;

  reorderProjectAgents(projectId: string, orderedAgentIds: string[]): Promise<ProjectAgent[]>;

  // ── Project Skills ─────────────────────────────────────────────────────

  getProjectSkills(projectId: string): Promise<ProjectSkill[]>;

  addProjectSkill(projectId: string, file: string, condition?: string): Promise<ProjectSkill>;

  removeProjectSkill(skillId: string): Promise<void>;

  // ── Project Variables ──────────────────────────────────────────────────

  getProjectVariables(projectId: string): Promise<ProjectVariable[]>;

  setProjectVariable(projectId: string, key: string, value: string): Promise<ProjectVariable>;

  deleteProjectVariable(projectId: string, key: string): Promise<void>;

  // ── Project Memory ─────────────────────────────────────────────────────

  getProjectMemory(projectId: string, producer?: "human" | "system"): Promise<ProjectMemory[]>;

  addProjectMemory(
    projectId: string,
    content: string,
    source?: string,
    producer?: "human" | "system"
  ): Promise<ProjectMemory>;

  deleteProjectMemory(memoryId: string): Promise<void>;

  // ── Project Threads ─────────────────────────────────────────────────────

  getProjectThreads(projectId: string): Promise<ProjectThread[]>;

  addProjectThread(projectId: string, threadId: string): Promise<ProjectThread>;

  removeProjectThread(projectId: string, threadId: string): Promise<void>;

  getProjectForThread(threadId: string): Promise<string | null>;

  // ── User Settings ─────────────────────────────────────────────────────

  getUserSettings(userId: string): Promise<UserSettings | null>;

  upsertUserSettings(
    userId: string,
    input: {
      default_provider?: string | null;
      models?: Record<string, string> | null;
      provenance: UserSettingsProvenance;
      changed_at?: string | null;
    },
    options?: { onlyIfNewer?: boolean },
  ): Promise<{ settings: UserSettings; updated: boolean }>;

  // ── Health ───────────────────────────────────────────────────────────

  healthCheck(): Promise<{ adapter: string; connected: boolean; latencyMs: number }>;
}

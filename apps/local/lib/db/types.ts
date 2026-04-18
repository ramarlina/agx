export type TaskStatus = "queued" | "in_progress" | "blocked" | "completed" | "failed";
export type TaskStage =
  | "INTAKE" | "PROGRESS" | "DONE"
  | "ideation" | "planning" | "execution" | "verification" | "done";

export interface TaskDependencySummary {
  id: string;
  title?: string;
  slug?: string;
  status?: TaskStatus;
  stage?: TaskStage;
}

export interface Task {
  id: string;
  user_id?: string;
  content: string;
  description?: string;
  swarm_models?: SwarmModel[];
  title?: string;
  slug?: string;
  identifier?: string | null;
  status?: TaskStatus;
  stage?: TaskStage;
  depends_on?: string[];
  blocked_reason?: string | null;
  project?: string;
  project_id?: string;
  priority?: number;
  engine?: string;
  provider?: string;
  model?: string;
  swarm?: boolean;
  retry_count?: number;
  error?: string;
  stage_decisions?: Record<string, { decision: string; rationale: string; final_result: string; decided_at: string }>;
  started_at?: string;
  completed_at?: string;
  pid?: number;
  exit_code?: number;
  signature?: string;
  workflow_id?: string | null;
  workflow_run_id?: string | null;
  orchestration_status?: string | null;
  last_orchestration_update?: string | null;
  graph_id?: string;
  created_at: string;
  updated_at: string;
  current_plan?: string;
  open_blockers?: string[];
  next_action?: string;
  version?: number;
  run_index?: RunIndexEntry[];
  created_by?: "user" | "ai";
  history?: TaskRunHistory[];
  depends_on_tasks?: TaskDependencySummary[];
  dependent_tasks?: TaskDependencySummary[];
}

export interface TaskRunHistory {
  id: string;
  task_id: string;
  pid?: number;
  exit_code?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  created_at: string;
}

export interface RunIndexEntry {
  run_id: string;
  stage: string;
  engine: string;
  model?: string;
  status: string;
  created_at: string;
  artifact_manifest?: ArtifactRef[];
  artifact_path?: string;
  artifact_host?: string;
  artifact_key?: string;
}

export interface ArtifactRef {
  kind: "prompt" | "output" | "events" | "logs" | "artifact";
  key: string;
  bytes?: number;
  sha256?: string;
}

export interface ProjectRepo {
  id: string;
  project_id: string;
  name: string;
  path: string;
  git_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id?: string;
  name: string;
  slug: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ci_cd_info?: string;
  workflow_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithRepos extends Project {
  repos: ProjectRepo[];
}

export interface ProjectRepoInput {
  id?: string;
  name: string;
  path: string;
  git_url?: string;
  notes?: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  repos?: ProjectRepoInput[];
  workflow_id?: string;
  identifier_prefix?: string | null;
}

export const IDENTIFIER_PREFIX_REGEX = /^[A-Z]{2,10}$/;

export function validateIdentifierPrefix(prefix: unknown): string | null {
  if (prefix === null || prefix === undefined || prefix === "") return null;
  if (typeof prefix !== "string") {
    throw new Error("identifier_prefix must be a string");
  }
  const trimmed = prefix.trim().toUpperCase();
  if (!IDENTIFIER_PREFIX_REGEX.test(trimmed)) {
    throw new Error(
      "identifier_prefix must be 2-10 uppercase ASCII letters (e.g. 'TSK', 'AGX')"
    );
  }
  return trimmed;
}

export type WorkflowNodeType = "step" | "gate" | "branch" | "terminal";
export type WorkflowTransitionCondition = "done" | "blocked" | "failed" | "retry" | "branch_a" | "branch_b";

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  definition: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  name: string;
  label?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  position: number;
  node_type: WorkflowNodeType;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowTransition {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  condition: WorkflowTransitionCondition;
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowWithGraph extends Workflow {
  nodes: WorkflowNode[];
  transitions: WorkflowTransition[];
}

export interface ProjectUpdatePayload {
  name?: string;
  slug?: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  ci_cd_info?: string | null;
  workflow_id?: string | null;
  repos?: ProjectRepoInput[];
  identifier_prefix?: string | null;
}

export interface TaskLog {
  id: string;
  task_id: string;
  content: string;
  log_type?: string;
  node_id?: string | null;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_type: "user" | "agent";
  author_id?: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
}

export type LearningScope = "task" | "project" | "global";

export interface SwarmModel {
  provider: string;
  model: string;
}

export type AgentStyle = "degen" | "conservative" | "specialist" | "balanced";

export interface Agent {
  id: string;
  user_id: string;
  name: string;
  role?: string;
  style: AgentStyle;
  description?: string;
  voice?: string;
  seed?: string;
  model?: string;
  provider?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentSkill {
  agent_id: string;
  file: string;
  condition?: string;
  created_at: string;
}

export interface ProjectAgent {
  project_id: string;
  agent_id: string;
  routing_order: number;
  created_at: string;
}

export interface ProjectSkill {
  id: string;
  project_id: string;
  file: string;
  condition?: string;
  created_at: string;
}

export interface ProjectVariable {
  project_id: string;
  key: string;
  value: string;
}

export interface ProjectMemory {
  id: string;
  project_id: string;
  content: string;
  source?: string;
  producer?: "human" | "system";
  created_at: string;
}

export interface ProjectThread {
  project_id: string;
  thread_id: string;
  created_at: string;
}

export interface Team {
  id: string;
  project_id: string;
  name: string;
  template_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEntry {
  id: string;
  project_id: string;
  category: string;
  name: string;
  path: string | null;
  purpose: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TeamAgent {
  team_id: string;
  agent_id: string;
  role_key: string;
  routing_order: number;
}

export interface SkillProvenance {
  file: string;
  condition?: string;
  source: "agent" | "project";
}

export interface MemoryProvenance {
  content: string;
  source: "agent" | "project";
  id?: string;
}

export interface ExecutionProvenance {
  skills: SkillProvenance[];
  memory: MemoryProvenance[];
  variables: Array<{ key: string; value: string; source: "project" }>;
}

export type UserSettingsProvenance = "cli" | "web";

export interface UserSettings {
  user_id: string;
  default_provider?: string | null;
  models: Record<string, string>;
  provenance: UserSettingsProvenance;
  changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface Learning {
  id: string;
  user_id?: string;
  scope: LearningScope;
  scope_id?: string;
  content: string;
  created_at: string;
}


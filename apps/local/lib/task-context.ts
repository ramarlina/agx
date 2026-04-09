import { createHash } from "crypto";
import { createAdminDbClient } from "./db-adapter";
import { getSQLiteDb } from "./sqlite-query-adapter";
import { listResolvedRepoKnowledge } from "./repo-knowledge";
import { getKnowledgeNote } from "./knowledge-notes";
import { vaultStore } from "./vault-store";
import { resolveMemoryAgentId } from "./memory-extractor";
import {
  Learning,
  Project,
  ProjectRepo,
  ProjectWithRepos,
  TaskComment,
  TaskStatus,
  TaskStage,
  parseFrontmatter,
  resolveTaskConfig,
  getUserSettings,
  UserSettings,
  getProjectBySlug,
  getProjectMemory,
  getProjectRepos,
  getProjectWithRepos,

  TaskRunHistory,
  defaultStagePrompts,
  DEFAULT_WORKFLOW_ID,
} from "./db";

export interface Task {
  id: string;
  user_id?: string;
  content: string;
  title?: string;
  status?: TaskStatus;
  stage?: TaskStage;
  pid?: number;
  exit_code?: number;
  project?: string | undefined;
  project_id?: string | undefined;
  workflow_id?: string | null;
  description?: string;
  slug?: string;
  engine?: string;
  created_at: string;
  updated_at: string;
  history?: TaskRunHistory[];
}

export interface TaskLearnings {
  task: Learning[];
  project: Learning[];
  global: Learning[];
}

export interface StageConfig {
  prompt: string | null;
  swarm?: boolean;
  provider?: string;
  model?: string;
  swarm_models?: Array<{ provider: string; model: string }>;
}

export interface ProjectContext {
  project: Project | null;
  repos: ProjectRepo[];
  learnings: string[];
}

export interface TaskContext {
  comments: TaskComment[];
  learnings: TaskLearnings;
  agent_memories: string[];
  stage_config: StageConfig;
  stage_prompt: string | null;
  stage_prompts: Record<string, string>;
  stage_objective: string | null;
  stageObjective: string | null;
  stagePrompts: Array<{ stage: string; prompt: string }>;
  comments_digest: string;
  project_context: ProjectContext | null;
  user_settings: UserSettings | null;
}

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("task_comments")
    .select("*")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    const message = typeof error.message === "string" ? error.message : "";
    const isMissingRelation =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      message.includes('relation "task_comments" does not exist') ||
      message.includes("Could not find the table 'agx.task_comments'") ||
      message.includes("Could not find the table 'public.task_comments'");
    if (isMissingRelation) {
      return [];
    }
    throw error;
  }
  return data || [];
}

export async function getTaskLearnings(task: Task): Promise<TaskLearnings> {
  const db = createAdminDbClient();
  const userId = task.user_id;

  const taskQuery = db
    .from("learnings")
    .select("*")
    .eq("scope", "task")
    .eq("scope_id", task.id);

  if (userId) taskQuery.eq("user_id", userId);

  const [{ data: taskLearnings, error: taskError }] = await Promise.all([taskQuery]);

  if (taskError) throw taskError;
  const globalLearnings = vaultStore.getLearnings("global");

  return {
    task: taskLearnings || [],
    project: [],
    global: globalLearnings || [],
  };
}

export async function getStageConfig(task: Task): Promise<StageConfig> {
  const stage = task.stage;
  if (!stage) return { prompt: null };

  const db = createAdminDbClient();

  // Prefer workflow nodes, then stage_prompts (legacy).
  const isValidUuid = (s?: string | null) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  let workflowId: string = isValidUuid(task.workflow_id) ? task.workflow_id! : "";
  if (!workflowId && task.project_id) {
    try {
      const project = await getProjectWithRepos(task.project_id, task.user_id);
      if (project?.workflow_id) workflowId = project.workflow_id;
    } catch {
      // ignore and fall through
    }
  }
  if (!workflowId) workflowId = DEFAULT_WORKFLOW_ID;

  // 1) Workflow node prompts (graph-backed)
  try {
    const { data: node, error } = await db
      .from("workflow_nodes")
      .select("*")
      .eq("workflow_id", workflowId)
      .eq("name", stage)
      .maybeSingle();

    if (!error && node) {
      const md = (node.metadata && typeof node.metadata === "object") ? node.metadata : {};
      const swarm = typeof (md as any).swarm === "boolean" ? (md as any).swarm : false;
      const swarm_models = Array.isArray((md as any).swarm_models) ? (md as any).swarm_models : undefined;
      if (node.prompt) {
        return {
          prompt: node.prompt,
          swarm,
          provider: node.provider || undefined,
          model: node.model || undefined,
          swarm_models,
        };
      }
      return {
        prompt: null,
        swarm,
        provider: node.provider || undefined,
        model: node.model || undefined,
        swarm_models,
      };
    }
  } catch {
    // ignore and fall through
  }

  // Fall back to stage_prompts table (legacy).
  try {
    const promises: any[] = [];
    // Prefer workflow-scoped prompts when the column exists.
    promises.push(
      db.from("stage_prompts")
        .select("*")
        .eq("stage", stage)
        .eq("is_default", true)
        .eq("workflow_id", workflowId)
        .maybeSingle()
    );
    if (task.user_id) {
      promises.push(
        db.from("stage_prompts")
          .select("*")
          .eq("stage", stage)
          .eq("user_id", task.user_id)
          .eq("workflow_id", workflowId)
          .maybeSingle()
      );
    }

    const results = await Promise.all(promises);
    const defaultPrompt: any = results[0]?.data || null;
    const stagePrompt: any = task.user_id ? (results[1] as any)?.data : null;

    const resolvedPrompt = stagePrompt?.prompt || defaultPrompt?.prompt || null;
    if (resolvedPrompt) {
      return {
        prompt: resolvedPrompt,
        swarm: stagePrompt?.swarm ?? defaultPrompt?.swarm ?? false,
        provider: stagePrompt?.provider || defaultPrompt?.provider,
        model: stagePrompt?.model || defaultPrompt?.model,
        swarm_models: stagePrompt?.swarm_models || defaultPrompt?.swarm_models,
      };
    }
  } catch {
    // ignore
  }

  // Final fallback: in-code defaults (keeps APIs from 500ing if DB is missing prompts).
  const fallback = (defaultStagePrompts as any)[stage];
  if (fallback?.prompt) {
    return {
      prompt: fallback.prompt,
      swarm: fallback.swarm ?? false,
      provider: fallback.provider,
      model: fallback.model,
      swarm_models: fallback.swarm_models,
    };
  }

  return { prompt: null };
}

function getRecentAgentMemories(agentId: string, limit = 5): string[] {
  try {
    const db = getSQLiteDb();
    const rows = db
      .prepare(
        "SELECT content FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(agentId, limit) as Array<{ content: string }>;
    return rows.map((r) => r.content);
  } catch {
    return [];
  }
}

function formatList(items: string[], emptyLabel: string): string {
  if (!items.length) return emptyLabel;
  return items.map((item) => `- ${item}`).join("\n");
}

function formatProjectMetadata(project: Project): string {
  const lines = [
    `Name: ${project.name}`,
    `Slug: ${project.slug}`,
    `Description: ${project.description?.trim() || "None"}`,
  ];



  return lines.join("\n");
}

function formatRepoLines(repos: ProjectRepo[]): string {
  if (!repos.length) return "(none)";

  return repos
    .map((repo) => {
      const parts = [`${repo.name}`];
      if (repo.path) parts.push(`path: ${repo.path}`);
      if (repo.notes) parts.push(`notes: ${repo.notes}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

async function resolveProjectContext(task: Task, _projectLearnings: Learning[]): Promise<ProjectContext | null> {
  const projectId = task.project_id;
  const projectSlug = task.project || undefined;
  let projectWithRepos: ProjectWithRepos | null = null;

  if (projectId) {
    projectWithRepos = await getProjectWithRepos(projectId, task.user_id);
  }

  if (!projectWithRepos && projectSlug) {
    const project = await getProjectBySlug(projectSlug, task.user_id);
    if (project) {
      const repos = await getProjectRepos(project.id);
      projectWithRepos = { ...project, repos };
    }
  }

  if (!projectWithRepos) {
    return null;
  }

  const projectKnowledge = await getProjectMemory(projectWithRepos.id, "human");
  const projectSystemNote = getKnowledgeNote("project", projectWithRepos.id);

  if (projectWithRepos.repos.length > 0) {
    const repoKnowledge = listResolvedRepoKnowledge(projectWithRepos.repos);
    const knowledgeByRepoId = new Map<string, string[]>();
    for (const entry of repoKnowledge) {
      if (!entry.repoId) continue;
      const content =
        entry.producer === "system"
          ? `[System-generated] ${entry.content}`
          : entry.content;
      const existing = knowledgeByRepoId.get(entry.repoId) ?? [];
      existing.push(content);
      knowledgeByRepoId.set(entry.repoId, existing);
    }

    projectWithRepos = {
      ...projectWithRepos,
      repos: projectWithRepos.repos.map((repo) => ({
        ...repo,
        notes: knowledgeByRepoId.has(repo.id)
          ? knowledgeByRepoId.get(repo.id)!.join("\n\n")
          : repo.notes,
      })),
    };
  }

  return {
    project: projectWithRepos,
    repos: projectWithRepos.repos ?? [],
    learnings: [
      ...projectKnowledge.map((entry) => entry.content),
      ...(projectSystemNote?.content ? [`[System-generated] ${projectSystemNote.content}`] : []),
    ],
  };
}

function isPromptRelevantComment(content: string): boolean {
  const normalized = String(content || "").trim();
  if (!normalized) return false;
  if (normalized.startsWith("[execution/")) return false;
  if (normalized.startsWith("Execution result from agx")) return false;
  return true;
}

export function computeCommentsDigest(comments: TaskComment[]): string {
  const normalized = comments.map((comment) => ({
    id: comment.id,
    task_id: comment.task_id,
    author_type: comment.author_type || null,
    author_id: comment.author_id || null,
    content: comment.content || "",
    created_at: comment.created_at || null,
  }));
  const serialized = JSON.stringify(normalized);
  return createHash("sha256").update(serialized).digest("hex");
}

export function buildTaskPrompt(args: {
  task: Task;
  comments: TaskComment[];
  learnings: TaskLearnings;
  agent_memories?: string[];
  stage_config: StageConfig;
  project_context: ProjectContext | null;
  user_settings: UserSettings | null;
}): string {
  const { task, comments, learnings, agent_memories, stage_config, project_context, user_settings } = args;
  const { body } = parseFrontmatter(task.content);
  const description = (task.description ?? body).trim();

  // Resolve configuration (Task > Stage)
  const config = resolveTaskConfig(task, stage_config, user_settings);

  const metaLines = [
    `Title: ${task.title || "Untitled"}`,
    `Slug: ${task.slug || "unspecified"}`,
    `Stage: ${task.stage || "INTAKE"}`,
    `Project: ${task.project || "none"}`,
    `Engine: ${task.engine || config.provider || "unspecified"}`,
    `Provider: ${config.provider}`,
    `Model: ${config.model}`,
    `Swarm: ${config.swarm ? "true" : "false"}`,
    `Swarm Models: ${config.swarm_models.length ? config.swarm_models.map((m) => `${m.provider}:${m.model}`).join(", ") : "none"}`,
  ];

  const commentLines = comments
    .filter((comment) => isPromptRelevantComment(comment.content))
    .map((comment) => {
      const when = comment.created_at ? new Date(comment.created_at).toISOString() : "unknown-time";
      const author = comment.author_type === "agent" ? "agent" : "user";
      return `[${when}] (${author}) ${comment.content}`;
    });

  const projectContextSections = project_context?.project
    ? [
      `PROJECT CONTEXT\n${formatProjectMetadata(project_context.project)}`,
      `REPOSITORY MAP\n${formatRepoLines(project_context.repos)}`,
      `PROJECT KNOWLEDGE\n${formatList(project_context.learnings, "(none)")}`,
    ]
    : [];

  const sections = [
    stage_config.prompt ? `STAGE PROMPT\n${stage_config.prompt}` : null,
    "EXECUTION RULES\n- Do not use AGX MCP tools or AGX MCP servers for this task.\n- Complete work using local edits, shell commands, and allowed HTTP APIs only.",
    `TASK META\n${metaLines.join("\n")}`,
    `TASK\n${description || "(empty)"}`,
    `COMMENTS\n${formatList(commentLines, "(none)")}`,
    ...projectContextSections,
    `TASK KNOWLEDGE\n${formatList(learnings.task.map((l) => l.content), "(none)")}`,
    `GLOBAL KNOWLEDGE\n${formatList(learnings.global.map((l) => l.content), "(none)")}`,
    agent_memories?.length ? `PAST LEARNINGS (from previous tasks)\n${formatList(agent_memories, "(none)")}` : null,
  ].filter(Boolean);

  return sections.join("\n\n");
}

export async function buildTaskContext(task: Task): Promise<TaskContext> {
  const [comments, learnings, stage_config, user_settings] = await Promise.all([
    getTaskComments(task.id),
    getTaskLearnings(task),
    getStageConfig(task),
    task.user_id ? getUserSettings(task.user_id) : Promise.resolve(null),
  ]);

  const project_context = await resolveProjectContext(task, learnings.project);
  const { frontmatter: taskFm } = parseFrontmatter(task.content);
  const agentMemoryId = resolveMemoryAgentId({
    defaultUserId: task.user_id || "system",
    frontmatter: taskFm as Record<string, unknown>,
  });
  const agent_memories = taskFm.no_memory ? [] : getRecentAgentMemories(agentMemoryId);

  const comments_digest = computeCommentsDigest(comments);
  const stageKey = typeof task.stage === "string" && task.stage.trim() ? task.stage.trim() : "";
  const stagePromptValue = stage_config.prompt ?? null;
  const stagePromptsMap: Record<string, string> = {};
  if (stagePromptValue && stageKey) {
    stagePromptsMap[stageKey] = stagePromptValue;
    const lowerStageKey = stageKey.toLowerCase();
    if (!stagePromptsMap[lowerStageKey]) {
      stagePromptsMap[lowerStageKey] = stagePromptValue;
    }
  }
  const stagePromptsList = stagePromptValue && stageKey
    ? [{ stage: stageKey, prompt: stagePromptValue }]
    : [];

  return {
    comments,
    learnings,
    agent_memories,
    stage_config,
    stage_prompt: stagePromptValue,
    stage_prompts: stagePromptsMap,
    stage_objective: stagePromptValue,
    stageObjective: stagePromptValue,
    stagePrompts: stagePromptsList,
    project_context,
    comments_digest,
    user_settings,
  };
}

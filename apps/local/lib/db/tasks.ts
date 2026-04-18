import { randomUUID } from "crypto";
import { createAdminDbClient } from "../db-adapter";
import { formatDependencyBlockedReason, isDependencyBlockedReason } from "../dependency-helpers";
import { notifyTaskEvent } from "../notifications";
import { getProjectWithRepos } from "./projects";
import {
  ensureNoCircularDependency,
  extractTitle,
  generateUniqueSlug,
  normalizeDependsOnInput,
  parseFrontmatter,
} from "./shared";
import type { RunIndexEntry, SwarmModel, Task, TaskStatus } from "./types";

function normalizeDescriptionBody(markdownBody: string): string {
  return String(markdownBody || "")
    .replace(/^#\s+.+(\r?\n|$)/, "")
    .trim();
}

async function ensureTaskDependencyState(task: Task, userId?: string): Promise<void> {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  if (!deps.length) return;

  const db = createAdminDbClient();
  const { data: depTasks, error } = await db
    .from("tasks")
    .select("id, title, slug, status, stage")
    .in("id", deps);

  if (error) return;

  const missingDependencies = (Array.isArray(depTasks) ? depTasks : []).filter(
    (entry) => (entry?.status || "") !== "completed"
  );

  if (missingDependencies.length) {
    const reason = formatDependencyBlockedReason(missingDependencies);
    let query = db
      .from("tasks")
      .update({ status: "blocked", blocked_reason: reason })
      .eq("id", task.id);
    if (userId) query = query.eq("user_id", userId);
    const { error: updateError } = await query;
    if (updateError && updateError.code !== "42703") {
      throw updateError;
    }
    return;
  }

  if (task.status === "blocked" && isDependencyBlockedReason(task.blocked_reason)) {
    let query = db
      .from("tasks")
      .update({ status: "queued", blocked_reason: null })
      .eq("id", task.id);
    if (userId) query = query.eq("user_id", userId);
    const { error: updateError } = await query;
    if (updateError && updateError.code !== "42703") {
      throw updateError;
    }
  }
}

export async function getTasks(
  userId?: string,
  filters?: { project?: string; status?: TaskStatus; search?: string; orphan?: boolean }
): Promise<Task[]> {
  const db = createAdminDbClient();

  let query = db
    .from("tasks")
    .select("*")
    .order("priority", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (userId) query = query.eq("user_id", userId);
  if (filters?.project) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.project);
    query = isUuid
      ? query.eq("project_id", filters.project)
      : query.eq("project", filters.project);
  }
  if (filters?.orphan) query = query.is("project_id", null);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.search) {
    const term = filters.search;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
    if (isUuid) {
      query = query.or(`id.eq.${term},slug.ilike.%${term}%,title.ilike.%${term}%`);
    } else {
      query = query.or(`id.ilike.%${term}%,slug.ilike.%${term}%,title.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  if (!filters?.orphan) {
    return rows;
  }

  return rows.filter((task: Task) => {
    const projectValue = String(task.project || "").trim().toLowerCase();
    return !projectValue || projectValue === "none";
  });
}

export async function getTask(id: string, userId?: string): Promise<Task | null> {
  const db = createAdminDbClient();

  let query = db
    .from("tasks")
    .select("*")
    .eq("id", id);

  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query.single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function getTaskBySlug(slug: string, userId?: string): Promise<Task | null> {
  const db = createAdminDbClient();

  let query = db
    .from("tasks")
    .select("*")
    .eq("slug", slug);

  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query.single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function createTask(
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
  }
): Promise<Task> {
  const db = createAdminDbClient();

  const { frontmatter, body } = parseFrontmatter(content);
  const swarm = typeof frontmatter.swarm === "boolean" ? frontmatter.swarm : undefined;
  const title = options?.title || extractTitle(content);
  const slugBase = String(frontmatter.slug || title || "task");
  const slug = await generateUniqueSlug(slugBase, db);
  const projectId = options?.projectId || (typeof frontmatter.project_id === "string" ? frontmatter.project_id : undefined);
  const workflowId = typeof frontmatter.workflow_id === "string" ? frontmatter.workflow_id : undefined;

  let projectSlug = typeof frontmatter.project === "string" ? frontmatter.project : undefined;
  if (!projectSlug && projectId) {
    const project = await getProjectWithRepos(projectId);
    if (project?.slug) projectSlug = project.slug;
  }

  const provider = typeof frontmatter.provider === "string" ? frontmatter.provider : null;
  const model = typeof frontmatter.model === "string" ? frontmatter.model : null;
  const engine = typeof frontmatter.engine === "string" ? frontmatter.engine : null;
  const createdBy = frontmatter.created_by === "ai" ? "ai" : "user";
  const frontmatterDepends = normalizeDependsOnInput(frontmatter.depends_on);
  const optionDepends = normalizeDependsOnInput(options?.dependsOn);
  const dependsOn = optionDepends.length > 0 ? optionDepends : frontmatterDepends;

  let identifier: string | null = null;
  if (projectId) {
    try {
      const { data: projectRow } = await db
        .from("projects")
        .select("identifier_prefix, next_identifier")
        .eq("id", projectId)
        .single();
      if (projectRow && typeof projectRow.identifier_prefix === "string" && projectRow.identifier_prefix) {
        const n = typeof projectRow.next_identifier === "number" ? projectRow.next_identifier : 1;
        identifier = `${projectRow.identifier_prefix}-${n}`;
        await db
          .from("projects")
          .update({ next_identifier: n + 1 })
          .eq("id", projectId);
      }
    } catch {
      identifier = null;
    }
  }

  const insertPayload: any = {
    id: randomUUID(),
    content,
    description: normalizeDescriptionBody(body),
    title,
    slug,
    status: frontmatter.status || "queued",
    stage: frontmatter.stage || "intake",
    project: projectSlug || null,
    ...(projectId !== undefined ? { project_id: projectId } : {}),
    ...(workflowId !== undefined ? { workflow_id: workflowId } : {}),
    ...(identifier !== null ? { identifier } : {}),
    priority: frontmatter.priority,
    engine,
    provider,
    model,
    swarm,
    swarm_models: options?.swarmModels ?? null,
    depends_on: dependsOn.length ? dependsOn : null,
    created_by: createdBy,
    user_id: userId,
    current_plan: options?.currentPlan || null,
    open_blockers: options?.openBlockers || [],
    next_action: options?.nextAction || null,
    version: 1,
  };

  await ensureNoCircularDependency(insertPayload.id, dependsOn, db);

  let { data, error } = await db
    .from("tasks")
    .insert(insertPayload)
    .select()
    .single();

  if (error && error.code === "42703") {
    const {
      swarm_models, swarm, workflow_id,
      current_plan, open_blockers, next_action, version,
      depends_on, identifier: _identifier,
      ...fallbackPayload
    } = insertPayload;
    ({ data, error } = await db
      .from("tasks")
      .insert(fallbackPayload)
      .select()
      .single());
  }

  if (error) throw error;
  if (!data) {
    throw new Error("Failed to create task");
  }

  await ensureTaskDependencyState(data, userId);
  const refreshed = await getTask(data.id, userId);
  const taskRecord = refreshed || data;
  const resolvedUserId = userId || taskRecord.user_id;
  if (resolvedUserId) {
    const eventTimestamp = taskRecord.created_at || new Date().toISOString();
    const details: Record<string, unknown> = {
      dependsOn: Array.isArray(taskRecord.depends_on) ? taskRecord.depends_on : [],
      project: taskRecord.project || null,
      projectId: taskRecord.project_id || null,
      workflowId: taskRecord.workflow_id || null,
      createdBy: taskRecord.created_by || null,
    };
    void notifyTaskEvent({
      taskId: taskRecord.id,
      userId: resolvedUserId,
      eventType: "task.created",
      title: taskRecord.title || null,
      slug: taskRecord.slug || null,
      stage: taskRecord.stage || null,
      status: taskRecord.status || null,
      timestamp: eventTimestamp,
      details,
    });
  }
  return taskRecord;
}

export async function updateTask(
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
  }
): Promise<Task> {
  const db = createAdminDbClient();

  const { frontmatter, body } = parseFrontmatter(content);
  const swarm = typeof frontmatter.swarm === "boolean" ? frontmatter.swarm : undefined;
  const title = extractTitle(content);
  const projectId = typeof frontmatter.project_id === "string" ? frontmatter.project_id : undefined;
  const hasProvider = Object.prototype.hasOwnProperty.call(frontmatter, "provider");
  const hasModel = Object.prototype.hasOwnProperty.call(frontmatter, "model");
  const hasWorkflowId = Object.prototype.hasOwnProperty.call(frontmatter, "workflow_id");
  const hasDependsOnInFrontmatter = Object.prototype.hasOwnProperty.call(frontmatter, "depends_on");
  const dependsFromFrontmatter = normalizeDependsOnInput(frontmatter.depends_on);
  const dependsFromOptions = normalizeDependsOnInput(options?.dependsOn);
  const shouldUpdateDepends = options?.dependsOn !== undefined || hasDependsOnInFrontmatter;
  const dependsOnForUpdate = options?.dependsOn !== undefined ? dependsFromOptions : dependsFromFrontmatter;

  const updatePayload: any = {
    content,
    description: normalizeDescriptionBody(body),
    title,
    status: frontmatter.status,
    stage: frontmatter.stage,
    project: frontmatter.project,
    ...(projectId !== undefined ? { project_id: projectId } : {}),
    workflow_id: hasWorkflowId ? (frontmatter as any).workflow_id : undefined,
    priority: frontmatter.priority,
    engine: frontmatter.engine,
    provider: hasProvider ? frontmatter.provider : null,
    model: hasModel ? frontmatter.model : null,
    swarm,
    swarm_models: options?.swarmModels ?? undefined,
    ...(shouldUpdateDepends ? { depends_on: dependsOnForUpdate.length ? dependsOnForUpdate : null } : {}),
    updated_at: new Date().toISOString(),
    current_plan: options?.currentPlan ?? undefined,
    open_blockers: options?.openBlockers ?? undefined,
    next_action: options?.nextAction ?? undefined,
  };

  Object.keys(updatePayload).forEach(key => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  if (shouldUpdateDepends) {
    await ensureNoCircularDependency(id, dependsOnForUpdate, db);
  }

  if (options?.expectedVersion !== undefined) {
    void options.expectedVersion;
  }

  let { data, error } = await db
    .from("tasks")
    .update({
      ...updatePayload,
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`[db.updateTask] error updating task ${id}:`, error);
  }
  if (!data && !error) {
    console.warn(`[db.updateTask] UPDATE returned 0 rows for task ${id}, payload keys:`, Object.keys(updatePayload));
  }

  if (error && error.code === "42703") {
    const {
      swarm_models, swarm, workflow_id,
      current_plan, open_blockers, next_action, version,
      depends_on,
      ...fallbackPayload
    } = updatePayload;
    let fallbackQuery = db
      .from("tasks")
      .update(fallbackPayload)
      .eq("id", id);
    if (userId) fallbackQuery = fallbackQuery.eq("user_id", userId);
    ({ data, error } = await fallbackQuery.select().maybeSingle());
  }

  if (error) throw error;
  if (!data) {
    const fallback = await getTask(id, userId);
    if (!fallback) throw new Error(`Task ${id} not found`);
    return fallback;
  }

  await ensureTaskDependencyState(data, userId);
  const refreshed = await getTask(data.id, userId);
  const taskRecord = refreshed || data;
  const resolvedUserId = userId || taskRecord.user_id;
  if (resolvedUserId) {
    const eventTimestamp = taskRecord.created_at || new Date().toISOString();
    const details: Record<string, unknown> = {
      dependsOn: Array.isArray(taskRecord.depends_on) ? taskRecord.depends_on : [],
      project: taskRecord.project || null,
      projectId: taskRecord.project_id || null,
      workflowId: taskRecord.workflow_id || null,
      createdBy: taskRecord.created_by || null,
    };
    void notifyTaskEvent({
      taskId: taskRecord.id,
      userId: resolvedUserId,
      eventType: "task.created",
      title: taskRecord.title || null,
      slug: taskRecord.slug || null,
      stage: taskRecord.stage || null,
      status: taskRecord.status || null,
      timestamp: eventTimestamp,
      details,
    });
  }
  return taskRecord;
}

export async function appendRunToIndex(
  taskId: string,
  runEntry: RunIndexEntry,
  maxRuns: number = 25
): Promise<void> {
  const db = createAdminDbClient();

  const { data: task, error: fetchError } = await db
    .from("tasks")
    .select("run_index")
    .eq("id", taskId)
    .single();

  if (fetchError) {
    if ((fetchError as any)?.code === "42703") return;
    throw fetchError;
  }

  const runIndex = Array.isArray(task.run_index) ? task.run_index : [];
  const updatedIndex = [runEntry, ...runIndex].slice(0, maxRuns);

  const { error: updateError } = await db
    .from("tasks")
    .update({ run_index: updatedIndex })
    .eq("id", taskId);

  if (updateError) {
    if ((updateError as any)?.code === "42703") return;
    throw updateError;
  }
}

export async function deleteTask(id: string, userId?: string): Promise<void> {
  const db = createAdminDbClient();
  let query = db.from("tasks").delete().eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw error;
}

export async function getNextQueuedTask(engine?: string): Promise<Task | null> {
  const db = createAdminDbClient();

  let query = db
    .from("tasks")
    .select("*")
    .eq("status", "queued")
    .order("priority", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (engine) query = query.eq("engine", engine);

  const { data, error } = await query.single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}


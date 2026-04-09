import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { getTicketType, type TicketType } from "@/lib/orchestration/stage-machine";
import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { parseFrontmatter } from "@/lib/db";
import type { TaskDependencySummary, Task } from "@/lib/db-adapter.interface";
import { db as dbAdapter } from "@/lib/db-instance";
import type { TaskJobData } from "@/lib/orchestrator/processor";

const READY_STATUS = "completed";

function normalizeDependsOnInput(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((entry) => String(entry || "").trim()).filter(Boolean)));
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((entry) => String(entry || "").trim()).filter(Boolean)));
      }
    } catch {
      // Fallback to comma-separated values.
    }
    return Array.from(new Set(trimmed.split(",").map((entry) => entry.trim()).filter(Boolean)));
  }
  return [];
}

function extractDependsOn(record: Partial<Task> | null | undefined): string[] {
  if (!record) return [];
  const direct = normalizeDependsOnInput((record as any).depends_on);
  if (direct.length) return direct;
  if (typeof (record as any).content === "string") {
    const { frontmatter } = parseFrontmatter((record as any).content || "");
    return normalizeDependsOnInput(frontmatter.depends_on);
  }
  return [];
}

function describeDependency(dep: TaskDependencySummary): string {
  return dep.title || dep.slug || dep.id || "(unknown)";
}

function summarizeRecord(record: Partial<Task> | null | undefined, id?: string): TaskDependencySummary {
  if (!record) {
    return { id: id || "" };
  }
  return {
    id: record.id || id || "",
    title: record.title || undefined,
    slug: record.slug || undefined,
    status: record.status as TaskDependencySummary["status"] | undefined,
    stage: record.stage as TaskDependencySummary["stage"] | undefined,
  };
}

async function fetchTasksByIds(ids: string[], userId?: string): Promise<TaskDependencySummary[]> {
  if (!ids.length) return [];
  const db = createAdminDbClient();
  let query = db
    .from("tasks")
    .select("id, title, slug, status, stage")
    .in("id", ids);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { data } = await query;
  const map = new Map<string, TaskDependencySummary>();

  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && row.id) {
        map.set(row.id, summarizeRecord(row, row.id));
      }
    }
  }

  // Only return tasks that actually exist in the DB.
  // Non-existent dependency IDs are ignored (treated as satisfied)
  // to avoid permanently blocking tasks with stale/invalid refs.
  return ids.map((id) => map.get(id)).filter((dep): dep is TaskDependencySummary => !!dep);
}

function formatMissingDependencies(missing: TaskDependencySummary[]): string {
  if (!missing.length) return "";
  const maxItems = 3;
  const entries = missing.slice(0, maxItems).map((dep) => {
    const label = describeDependency(dep);
    const statusLabel = dep.stage === "INTAKE" ? "awaiting approval" : (dep.status || "");
    const suffix = statusLabel ? ` (${statusLabel})` : "";
    return `${label}${suffix}`;
  });
  let message = `Waiting on dependencies: ${entries.join(", ")}`;
  if (missing.length > maxItems) {
    message += ` +${missing.length - maxItems} more`;
  }
  return message;
}

export async function loadTaskDependencyGraph(taskId: string, userId?: string) {
  const db = createAdminDbClient();
  let dependsOn: string[] = [];
  const { data, error } = await db
    .from("tasks")
    .select("depends_on, content")
    .eq("id", taskId)
    .maybeSingle();
  if (!error) {
    dependsOn = extractDependsOn(data);
  } else if (error.code === "42703") {
    const { data: fallbackData } = await db
      .from("tasks")
      .select("content")
      .eq("id", taskId)
      .maybeSingle();
    dependsOn = extractDependsOn(fallbackData);
  }
  const dependsOnTasks = await fetchTasksByIds(dependsOn, userId);

  let dependentsQuery = db
    .from("tasks")
    .select("id, title, slug, status, stage")
    .contains("depends_on", [taskId]);
  if (userId) {
    dependentsQuery = dependentsQuery.eq("user_id", userId);
  }
  const { data: dependents, error: dependentsError } = await dependentsQuery;
  let resolvedDependents = Array.isArray(dependents)
    ? dependents.map((row) => summarizeRecord(row, row?.id))
    : [];
  if (dependentsError && dependentsError.code === "42703") {
    let fallbackDependentsQuery = db
      .from("tasks")
      .select("id, title, slug, status, stage, content");
    if (userId) {
      fallbackDependentsQuery = fallbackDependentsQuery.eq("user_id", userId);
    }
    const { data: fallbackDependents } = await fallbackDependentsQuery;
    const scanned = Array.isArray(fallbackDependents) ? fallbackDependents : [];
    resolvedDependents = scanned
      .filter((row) => extractDependsOn(row).includes(taskId))
      .map((row) => summarizeRecord(row, row?.id));
  }

  return {
    depends_on_tasks: dependsOnTasks,
    dependent_tasks: resolvedDependents,
  };
}

export async function getMissingDependencies(task: Task, userId?: string): Promise<TaskDependencySummary[]> {
  const dependsOn = extractDependsOn(task);
  if (!dependsOn.length) return [];
  const records = await fetchTasksByIds(dependsOn, userId);
  return records.filter((dep) => (dep.status || "") !== READY_STATUS);
}

export interface AttemptStartResult {
  started: boolean;
  jobId?: string | null;
  missingDependencies: TaskDependencySummary[];
  blockedReason?: string;
  alreadyQueued?: boolean;
  ticketType?: TicketType;
}

export async function attemptStartTask(
  taskId: string,
  userId?: string,
  options?: { force?: boolean; ticketType?: TicketType }
): Promise<AttemptStartResult> {
  const resolvedUserId = userId || LOCAL_USER.id;
  const task = await dbAdapter.getTask(taskId, resolvedUserId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const missingDependencies = await getMissingDependencies(task, resolvedUserId);
  if (missingDependencies.length) {
    const reason = formatMissingDependencies(missingDependencies);
    const adminDb = createAdminDbClient();
    const { error } = await adminDb
      .from("tasks")
      .update({
        status: "blocked",
        blocked_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    if (error && error.code !== "42703") {
      throw error;
    }
    return {
      started: false,
      missingDependencies,
      blockedReason: reason,
    };
  }

  if (!options?.force && task.status === "queued" && !task.blocked_reason) {
    return {
      started: false,
      missingDependencies: [],
      alreadyQueued: true,
    };
  }

  const { frontmatter, body } = parseFrontmatter(task.content || "");
  const ticketType = options?.ticketType ?? getTicketType(frontmatter, body);

  const queue = await getQueue();
  const jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
    taskId,
    userId: resolvedUserId,
    signal: "start",
    ticketType,
  } as TaskJobData);

  const adminDb = createAdminDbClient();
  const { error } = await adminDb
    .from("tasks")
    .update({
      status: "queued",
      blocked_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (error && error.code !== "42703") {
    throw error;
  }

  return {
    started: Boolean(jobId),
    jobId,
    missingDependencies: [],
    ticketType,
  };
}

export async function triggerDependentTasks(taskId: string, userId?: string) {
  const resolvedUserId = userId || LOCAL_USER.id;
  const db = createAdminDbClient();
  let query = db
    .from("tasks")
    .select("id")
    .contains("depends_on", [taskId]);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query;
  let dependentIds = Array.isArray(data)
    ? data.map((row) => row?.id).filter(Boolean)
    : [];
  if (error && error.code === "42703") {
    let fallbackQuery = db
      .from("tasks")
      .select("id, content");
    if (userId) {
      fallbackQuery = fallbackQuery.eq("user_id", userId);
    }
    const { data: fallbackTasks } = await fallbackQuery;
    dependentIds = (Array.isArray(fallbackTasks) ? fallbackTasks : [])
      .filter((row) => extractDependsOn(row).includes(taskId))
      .map((row) => row?.id)
      .filter(Boolean);
  }
  if (!dependentIds.length) return;

  await Promise.all(
    dependentIds.map((dependentId) => attemptStartTask(dependentId as string, resolvedUserId))
  );
}

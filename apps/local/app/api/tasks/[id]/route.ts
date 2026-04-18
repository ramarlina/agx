import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { parseFrontmatter, resolveTaskConfig } from "@/lib/db";
import { createAdminDbClient } from "@/lib/db-adapter";
import { buildTaskContext } from "@/lib/task-context";

import { LOCAL_USER } from "@/lib/auth-mode";
import {
  extractAndStoreMemories,
  extractAndStoreProjectKnowledge,
  resolveMemoryAgentId,
} from "@/lib/memory-extractor";
import { projectTaskReadModel } from "@/src/graph/read-path";
import { logger } from "@/lib/logger";

const ALLOWED_STATUSES = new Set(["queued", "in_progress", "blocked", "completed", "failed"]);

function mapStageAlias(stage: string): string {
  const upper = stage.trim().toUpperCase();
  if (upper === "INTAKE" || upper === "PROGRESS" || upper === "DONE") return upper;
  // Map legacy names
  const normalized = stage.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "ideation" || normalized === "intake") return "INTAKE";
  if (["planning", "coding", "execution", "qa", "acceptance", "pr", "smoke_test", "release", "verification", "progress", "in_progress"].includes(normalized)) return "PROGRESS";
  if (normalized === "done") return "DONE";
  return stage;
}

function normalizeStage(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return mapStageAlias(s);
}

function isValidStageId(stage: string): boolean {
  // Keep validation permissive but avoid obviously broken values.
  if (stage.length > 64) return false;
  return /^[a-z0-9 _-]+$/i.test(stage);
}

function normalizeDependsOnInput(input: unknown): string[] | undefined {
  if (input === undefined) return undefined;
  if (input === null) return [];

  const normalizeToken = (value: unknown): string => String(value || "").trim();

  if (Array.isArray(input)) {
    return Array.from(new Set(input.map(normalizeToken).filter(Boolean)));
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(normalizeToken).filter(Boolean)));
      }
    } catch {
      // Fallback to comma-separated values.
    }
    return Array.from(
      new Set(
        trimmed
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      )
    );
  }

  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTaskIdSync(rawId: unknown): string | null {
  if (typeof rawId === "string") {
    const normalized = rawId.trim();
    if (!normalized) return null;
    if (normalized === "[object Object]" || normalized === "undefined" || normalized === "null") {
      return null;
    }
    if (!UUID_RE.test(normalized)) return null;
    return normalized;
  }

  if (rawId && typeof rawId === "object" && "id" in rawId) {
    return normalizeTaskIdSync((rawId as { id?: unknown }).id);
  }

  return null;
}

/** Resolve a task identifier (UUID or slug) to a UUID. */
async function normalizeTaskId(rawId: unknown): Promise<string | null> {
  const syncResult = normalizeTaskIdSync(rawId);
  if (syncResult) return syncResult;

  // Not a UUID — try slug lookup
  if (typeof rawId === "string") {
    const slug = rawId.trim();
    if (!slug) return null;
    const adminDb = createAdminDbClient();
    const { data } = await adminDb
      .from("tasks")
      .select("id")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  }

  return null;
}

// GET /api/tasks/[id] - Get a single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id: rawId } = await params;
    const id = await normalizeTaskId(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const task = await db.getTask(id, userId);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const projectedTask = await projectTaskReadModel(task);
    const context = await buildTaskContext(task);
    const resolvedConfig = resolveTaskConfig(projectedTask, context.stage_config, context.user_settings);
    const taskPayload = {
      ...projectedTask,
      ...context,
      resolved_provider: resolvedConfig.provider,
      resolved_model: resolvedConfig.model ?? undefined,
      resolved_swarm: resolvedConfig.swarm,
      resolved_swarm_models: resolvedConfig.swarm_models,
    };

    return NextResponse.json({
      task: taskPayload,
      stage_prompt: taskPayload.stage_prompt,
      stage_prompts: taskPayload.stage_prompts,
      stage_objective: taskPayload.stage_objective,
      stageObjective: taskPayload.stageObjective,
      stagePrompts: taskPayload.stagePrompts,
    });
  } catch (error) {
    logger.error("Error fetching task", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

// PUT /api/tasks/[id] - Update a task (full content replacement)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id: rawId } = await params;
    const id = await normalizeTaskId(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const task = await db.updateTask(id, content, userId);
    return NextResponse.json({ task });
  } catch (error) {
    logger.error("Error updating task", logger.formatError(error));
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

// PATCH /api/tasks/[id] - Partial update (stage, status, priority, provider, model, swarm, title, description, project, project_id)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id: rawId } = await params;
    const id = await normalizeTaskId(rawId);

    if (!id) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const body = await request.json();

    const {
      stage, status, priority,
      provider, model, swarm,
      approval_mode,
      started_at, completed_at,
      title, description, content,
      swarm_models,
      depends_on,
      project, project_id,
      pid, exit_code
    } = body;
    const normalizedDependsOn = normalizeDependsOnInput(depends_on);
    const hasDependsOn = normalizedDependsOn !== undefined;

    const normalizedStage = stage !== undefined ? normalizeStage(stage) : null;
    if (stage !== undefined) {
      if (!normalizedStage || !isValidStageId(normalizedStage)) {
        return NextResponse.json({ error: "Invalid stage value" }, { status: 400 });
      }
    }
    if (status !== undefined && !ALLOWED_STATUSES.has(String(status))) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    const hasStartedAt = Object.prototype.hasOwnProperty.call(body, "started_at");
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(body, "completed_at");
    const hasPid = Object.prototype.hasOwnProperty.call(body, "pid");
    const hasExitCode = Object.prototype.hasOwnProperty.call(body, "exit_code");

    // Get current task
    const task = await db.getTask(id, userId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Parse current content
    const { frontmatter, body: currentMarkdownBody } = parseFrontmatter(task.content);

    // Determine new body text (description or content can be used)
    // If neither provided, keep current.
    let nextBody = currentMarkdownBody;
    if (description !== undefined) nextBody = description === null ? "" : String(description);
    else if (content !== undefined) nextBody = content === null ? "" : String(content);

    // Update frontmatter fields
    if (stage !== undefined && normalizedStage) frontmatter.stage = normalizedStage;
    if (status !== undefined) frontmatter.status = status;
    if (priority !== undefined) frontmatter.priority = priority;
    if (swarm !== undefined) frontmatter.swarm = swarm;
    if (approval_mode !== undefined) {
      if (approval_mode === null || approval_mode === "") delete frontmatter.approval_mode;
      else frontmatter.approval_mode = approval_mode;
    }
    if (hasDependsOn) {
      frontmatter.depends_on = normalizedDependsOn;
    }
    if (project !== undefined) frontmatter.project = project;
    if (project_id !== undefined) frontmatter.project_id = project_id;

    if (provider !== undefined) {
      if (provider === null || provider === "") delete frontmatter.provider;
      else frontmatter.provider = provider;
    }

    if (model !== undefined) {
      if (model === null || model === "") delete frontmatter.model;
      else frontmatter.model = model;
    }

    // Handle Title Update (H1 in markdown)
    // We need to ensure the markdown starts with the correct title
    const effectiveTitle = title !== undefined ? title : task.title;

    // Remove existing H1 title from nextBody if it exists to avoid duplication
    // (Assuming simple "# Title" format at start or after newlines)
    nextBody = nextBody.replace(/^#\s+.+(\r?\n|$)/, "").trim();

    // Reconstruct content
    const frontmatterStr = Object.entries(frontmatter)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    // Prepend title if we have one
    const contentWithTitle = effectiveTitle
      ? `# ${effectiveTitle}\n\n${nextBody}`
      : nextBody;

    const updatedContent = `---\n${frontmatterStr}\n---\n${contentWithTitle}`;

    const updateOptions: {
      swarmModels?: Array<{ provider: string; model: string }> | null;
      dependsOn?: string[] | null;
    } = {};
    if (swarm_models !== undefined) {
      updateOptions.swarmModels = swarm_models;
    }
    if (hasDependsOn) {
      updateOptions.dependsOn = normalizedDependsOn || [];
    }

    let updatedTask = await db.updateTask(
      id,
      updatedContent,
      userId,
      Object.keys(updateOptions).length ? updateOptions : undefined
    );

    if (hasStartedAt || hasCompletedAt || hasPid || hasExitCode) {
      const extraUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (hasStartedAt) extraUpdates.started_at = started_at;
      if (hasCompletedAt) extraUpdates.completed_at = completed_at;

      // If we have an exit code, it means the run is finishing.
      // We should archive this run to history and clear the current PID/exit_code from the main table.
      if (hasExitCode) {
        const adminDb = createAdminDbClient();

        // 1. Get current state to archive (we need start time and PID which might be in DB, or in this payload)
        // usage: prefer payload values, fallback to current task values
        const finalPid = hasPid ? pid : task.pid;
        const finalStartedAt = hasStartedAt ? started_at : task.started_at;
        const finalCompletedAt = hasCompletedAt ? completed_at : new Date().toISOString();

        if (finalPid) {
          await adminDb
            .from("task_run_history")
            .insert({
              task_id: id,
              pid: finalPid,
              exit_code: exit_code,
              started_at: finalStartedAt,
              completed_at: finalCompletedAt,
              error: task.error // Archive last error state if any
            });
        }

        // 2. Clear current state from tasks table (user request: "null when done")
        extraUpdates.pid = null;
        extraUpdates.exit_code = null;
        // We keep started_at/completed_at on the main task as "last run" metadata or clear them?
        // User said "values on the task table only reflect current". 
        // Usually `started_at`/`completed_at` on the task are useful for "Last Run" display.
        // But if they reflect "Current", they should probably be cleared or left as "Last".
        // A common pattern is `started_at` is start of *latest* run, `completed_at` is end of *latest* run.
        // The user specifically asked "null when done" in context of "pid" discussion. 
        // Let's assume they might want to clear PID/ExitCode specifically. 
        // However, if we clear `started_at`, we lose "when did this task last run?".
        // I will clear PID and ExitCode as requested effectively making it "not running".

      } else {
        // Not finishing, just updating state (e.g. starting)
        if (hasPid) extraUpdates.pid = pid;
      }

      const adminDb = createAdminDbClient();
      const { data: extraUpdate, error: extraError } = await adminDb
        .from("tasks")
        .update(extraUpdates)
        .eq("id", id)
        .select()
        .maybeSingle();

      if (!extraError && extraUpdate) {
        updatedTask = extraUpdate;
      }
    }

    // Fire-and-forget memory extraction on terminal status transitions
    const isTerminal = status === "completed" || status === "failed";
    const wasTerminal = task.status === "completed" || task.status === "failed";
    if (isTerminal && !wasTerminal) {
      const memoryAgentId = resolveMemoryAgentId({
        defaultUserId: updatedTask.user_id || "system",
        frontmatter: parseFrontmatter(String(updatedTask.content || "")).frontmatter as Record<string, unknown>,
      });
      extractAndStoreMemories(id, memoryAgentId, {
        goal: String(updatedTask.content || updatedTask.title || ""),
        status: String(status),
      }).catch((err) => console.warn("[tasks/PATCH] Memory extraction failed:", err));
      extractAndStoreProjectKnowledge(id, updatedTask.project_id || updatedTask.project, {
        goal: String(updatedTask.content || updatedTask.title || ""),
        status: String(status),
      }).catch((err) => console.warn("[tasks/PATCH] Project knowledge extraction failed:", err));
    }

    const context = await buildTaskContext(updatedTask);
    const resolvedConfig = resolveTaskConfig(updatedTask, context.stage_config, context.user_settings);

    const taskPayload = {
      ...updatedTask,
      ...context,
      resolved_provider: resolvedConfig.provider,
      resolved_model: resolvedConfig.model ?? undefined,
      resolved_swarm: resolvedConfig.swarm,
      resolved_swarm_models: resolvedConfig.swarm_models,
    };
    return NextResponse.json({
      task: taskPayload,
      stage_prompt: taskPayload.stage_prompt,
      stage_prompts: taskPayload.stage_prompts,
      stage_objective: taskPayload.stage_objective,
      stageObjective: taskPayload.stageObjective,
      stagePrompts: taskPayload.stagePrompts,
    });
  } catch (error) {
    logger.error("Error patching task", logger.formatError(error));
    return NextResponse.json({
      error: "Failed to patch task",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id: rawId } = await params;
    const id = await normalizeTaskId(rawId);
    if (!id) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    await db.deleteTask(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error deleting task", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}

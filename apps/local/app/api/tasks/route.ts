import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { resolveTaskConfig } from "@/lib/db";
import type { TaskStatus } from "@/lib/db-adapter.interface";
import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  detectDangerousOperations,
  writeAuditLog
} from "@/lib/security";
import { buildTaskContext } from "@/lib/task-context";
import { attemptStartTask } from "@/lib/dependency-manager";
import { notifyTaskEvent } from "@/lib/notifications";
import { dualWriteTaskCreation } from "@/src/graph/dual-write";
import { projectTaskReadModel, projectTaskReadModels } from "@/src/graph/read-path";
import { logger } from "@/lib/logger";

// GET /api/tasks - List all tasks
export async function GET(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;
    const { searchParams } = new URL(request.url);
    const project = searchParams.get("project") || undefined;
    const orphan = searchParams.get("orphan") === "1";
    const statusRaw = searchParams.get("status");
    const status = (statusRaw ? statusRaw : undefined) as TaskStatus | undefined;
    const slug = searchParams.get("slug");
    const search = searchParams.get("search") || undefined;

    if (slug) {
      const task = await db.getTaskBySlug(slug, userId);
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      const projectedTask = await projectTaskReadModel(task);
      const context = await buildTaskContext(task);
      const resolvedConfig = resolveTaskConfig(task, context.stage_config, context.user_settings);
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
    }

    const tasks = await db.getTasks(userId, { project, status, search, orphan });
    const projected = await projectTaskReadModels(tasks);
    return NextResponse.json({ tasks: projected });
  } catch (error) {
    logger.error("Error fetching tasks", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
// Task is added to queue (status: queued) - user's local daemon pulls and executes
export async function POST(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const body = await request.json();
    const { content, swarm_models, project_id, title } = body;
    const dependsOnInput = Array.isArray(body?.depends_on)
      ? body.depends_on
      : typeof body?.depends_on === "string"
        ? [body.depends_on]
        : undefined;

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    // Check for dangerous operations
    const dangerCheck = detectDangerousOperations(content);
    if (dangerCheck.isDangerous && dangerCheck.severity === "critical") {
      return NextResponse.json({
        error: "Task contains potentially dangerous operations",
        dangerous: true,
        severity: dangerCheck.severity,
        patterns: dangerCheck.patterns,
        message: "This task has been blocked. Please review and remove dangerous commands.",
      }, { status: 400 });
    }

    // Create the task
    const createdTask = await db.createTask(content, userId, {
      swarmModels: swarm_models,
      dependsOn: dependsOnInput,
      projectId: typeof project_id === "string" ? project_id : undefined,
      title: typeof title === "string" ? title : undefined,
    });

    await attemptStartTask(createdTask.id, userId);

    const refreshedTask = await db.getTask(createdTask.id, userId);
    const task = refreshedTask || createdTask;

    const dualWriteResult = await dualWriteTaskCreation(task);
    if (dualWriteResult.result === "failed") {
      logger.error("Task dual-write graph creation failed", {
        taskId: task.id,
        error: dualWriteResult.error,
      });
    }

    // Link graph_id back to the task row so the graph page can find it
    if (dualWriteResult.graphId) {
      const adminDb2 = createAdminDbClient();
      await adminDb2
        .from("tasks")
        .update({ graph_id: dualWriteResult.graphId })
        .eq("id", task.id);
      task.graph_id = dualWriteResult.graphId;
    }

    const context = await buildTaskContext(task);
    const { comments_digest: commentsDigest, stage_config } = context;

    // Resolve configuration (Task > Stage)
    const resolvedConfig = resolveTaskConfig(task, stage_config, context.user_settings);

    // Write audit log
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || request.headers.get("x-real-ip")
      || undefined;
    const userAgent = request.headers.get("user-agent") || undefined;

    await writeAuditLog({
      user_id: userId,
      task_id: task.id,
      action: "dispatch",
      payload: {
        title: task.title,
        stage: task.stage,
        engine: task.engine,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model ?? undefined,
        swarm: resolvedConfig.swarm,
        swarm_models: resolvedConfig.swarm_models,
        project: task.project,
        dangerous: dangerCheck.isDangerous ? {
          severity: dangerCheck.severity,
          patterns: dangerCheck.patterns,
        } : null,
      },
      signature: "unsigned",
      ip_address: ip,
      user_agent: userAgent,
      result: "pending",
    });

    // Include resolved config in response without overwriting explicit task overrides.
    const taskPayload = {
      ...task,
      ...context,
      resolved_provider: resolvedConfig.provider,
      resolved_model: resolvedConfig.model ?? undefined,
      resolved_swarm: resolvedConfig.swarm,
      resolved_swarm_models: resolvedConfig.swarm_models,
    };
    const response: Record<string, unknown> = {
      id: task.id,
      task: taskPayload,
      stage_prompt: taskPayload.stage_prompt,
      stage_prompts: taskPayload.stage_prompts,
      stage_objective: taskPayload.stage_objective,
      stageObjective: taskPayload.stageObjective,
      stagePrompts: taskPayload.stagePrompts,
      graph_dual_write: dualWriteResult,
    };
    if (dangerCheck.isDangerous) {
      response.warning = {
        message: "Task contains potentially dangerous operations. Daemon may prompt for confirmation.",
        severity: dangerCheck.severity,
        patterns: dangerCheck.patterns,
      };
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    logger.error("Error creating task", logger.formatError(error));
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

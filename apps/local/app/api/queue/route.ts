import { NextRequest, NextResponse } from "next/server";
import { resolveTaskConfig } from "@/lib/db";
import { createAdminDbClient } from "@/lib/db-adapter";
import { writeAuditLog } from "@/lib/security";
import { buildTaskContext } from "@/lib/task-context";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getMissingDependencies } from "@/lib/dependency-manager";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";
import { logger } from "@/lib/logger";

function formatDependencyBlockedReason(missingDependencies: Array<{ id?: string; title?: string; slug?: string; status?: string }>): string {
  if (!missingDependencies.length) return "";
  const maxItems = 3;
  const entries = missingDependencies.slice(0, maxItems).map((dep) => {
    const label = dep.title || dep.slug || dep.id || "(unknown)";
    const suffix = dep.status ? ` (${dep.status})` : "";
    return `${label}${suffix}`;
  });
  let message = `Waiting on dependencies: ${entries.join(", ")}`;
  if (missingDependencies.length > maxItems) {
    message += ` +${missingDependencies.length - maxItems} more`;
  }
  return message;
}

// GET /api/queue - Peek next task from queue (for daemon workers)
// Requires authentication - daemon must be logged in
export async function GET(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const { searchParams } = new URL(request.url);
    const engine = searchParams.get("engine") || undefined;
    
    // Pull next stage dispatch assigned by Temporal.
    const adminDb = createAdminDbClient();

    let query = adminDb
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "queued")
      .neq("stage", "done")
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(25);
    
    if (engine) {
      query = query.eq("engine", engine);
    }
    
    const { data: tasks, error } = await query;
    
    if (error) {
      throw error;
    }
    
    let task = null;
    if (Array.isArray(tasks)) {
      for (const candidate of tasks) {
        const missingDependencies = await getMissingDependencies(candidate, userId);
        if (missingDependencies.length) {
          // Skip tasks with unmet deps but don't mutate their status.
          // They stay "queued" and will be re-evaluated on the next poll.
          continue;
        }
        task = candidate;
        break;
      }
    }

    if (!task) {
      return NextResponse.json({ task: null, message: "No tasks in queue" });
    }

    const nowIso = new Date().toISOString();
    let claimedTask = task;
    if (task.status !== "in_progress") {
      const updatePayload: Record<string, string> = {
        status: "in_progress",
        updated_at: nowIso,
      };
      if (!task.started_at) {
        updatePayload.started_at = nowIso;
      }

      if (task.graph_id) {
        await syncTaskProgressForGraphExecution({
          taskId: task.id,
          userId,
          status: "in_progress",
          nowIso,
          startedAt: task.started_at || nowIso,
        });
        updatePayload.stage = "PROGRESS";
      } else {
        await adminDb
          .from("tasks")
          .update(updatePayload)
          .eq("id", task.id)
          .eq("user_id", userId);
      }

      claimedTask = {
        ...task,
        ...updatePayload,
      };
    }

    // Return task context/signature after transitioning to agent_running.
    const context = await buildTaskContext(claimedTask);
    const { comments_digest: commentsDigest, stage_config, user_settings } = context;

    // Resolve configuration (Task > Stage)
    const resolvedConfig = resolveTaskConfig(claimedTask, stage_config, user_settings);

    // Write audit log for task dispatch
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() 
      || request.headers.get("x-real-ip") 
      || undefined;
    const userAgent = request.headers.get("user-agent") || undefined;
    
    await writeAuditLog({
      user_id: userId,
      task_id: claimedTask.id,
      action: "execute",
      payload: {
        title: claimedTask.title,
        stage: claimedTask.stage,
        engine: claimedTask.engine,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model ?? undefined,
        swarm: resolvedConfig.swarm,
        swarm_models: resolvedConfig.swarm_models,
      },
      signature: "unsigned",
      ip_address: ip,
      user_agent: userAgent,
      result: "pending",
    });

    const taskPayload = {
      ...claimedTask,
      ...resolvedConfig, // Include resolved config in the response
      ...context,
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
    logger.error("Error pulling from queue", logger.formatError(error));
    return NextResponse.json({ error: "Failed to pull from queue" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { getPromptJobStore } from "@/src/prompt-scheduler/get-store";
import {
  TASK_WORKER_JOB_NAME,
  TASK_WORKER_DEFAULT_PROMPT,
  TASK_WORKER_DEFAULT_CADENCE,
  findTaskWorkerJob,
} from "@/src/prompt-scheduler/task-worker-job";
import {
  computePrevRun,
  parseCadence,
} from "@/src/prompt-scheduler/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/trackers/[tracker]/worker
 * Return the current task worker config (the prompt job with executionMode === 'task_worker').
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker: _tracker } = await params;
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
    const job = findTaskWorkerJob(projectId);

    if (!job) {
      return NextResponse.json({ job: null });
    }

    const cronExpr = job.cronExpr || job.cadence;
    const prevScheduledAt = cronExpr ? computePrevRun(cronExpr) : null;

    return NextResponse.json({ job: { ...job, prevScheduledAt } });
  } catch (error) {
    console.error("Failed to get task worker:", error);
    return NextResponse.json(
      { error: "Failed to get task worker", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trackers/[tracker]/worker
 * Create or update the task worker prompt job.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker: _tracker } = await params;
  try {
    const body = await req.json();
    const {
      projectId,
      prompt,
      scriptPrompt,
      cadence,
      agentId,
      provider,
      model,
      state,
      teamId,
    } = body;

    const store = getPromptJobStore();
    const existing = findTaskWorkerJob(projectId);

    if (existing) {
      // Update existing
      const updates: Record<string, unknown> = {};
      if (typeof prompt === "string") updates.prompt = prompt;
      if (typeof scriptPrompt === "string") updates.scriptPrompt = scriptPrompt;
      if (typeof teamId === "string") updates.teamId = teamId;
      if (typeof agentId === "string") updates.agentId = agentId;
      if (typeof provider === "string") updates.provider = provider;
      if (typeof model === "string") updates.model = model;
      if (typeof state === "string") updates.state = state;

      if (typeof cadence === "string" && cadence.trim()) {
        const parsed = parseCadence(cadence.trim());
        if (parsed) {
          updates.cadence = parsed.cadence;
          updates.cronExpr = parsed.cronExpr;
        } else {
          return NextResponse.json(
            { error: `Could not parse cadence: "${cadence}"` },
            { status: 400 }
          );
        }
      }

      const job = store.updateJob(existing.id, updates);
      return NextResponse.json({ job });
    }

    // Create new
    const resolvedPrompt = typeof prompt === "string" && prompt.trim()
      ? prompt
      : TASK_WORKER_DEFAULT_PROMPT;

    const resolvedCadence = typeof cadence === "string" && cadence.trim()
      ? cadence
      : TASK_WORKER_DEFAULT_CADENCE;

    const job = store.createJob({
      name: TASK_WORKER_JOB_NAME,
      prompt: resolvedPrompt,
      scriptPrompt: typeof scriptPrompt === "string" ? scriptPrompt : undefined,
      teamId: typeof teamId === "string" ? teamId : undefined,
      executionMode: "task_worker",
      projectId: projectId || undefined,
      builtIn: true,
      cadence: resolvedCadence,
      provider: provider ?? "claude",
      model,
      agentId,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error("Failed to create/update task worker:", error);
    return NextResponse.json(
      { error: "Failed to create/update task worker", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trackers/[tracker]/worker
 * Remove/disable the task worker.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker: _tracker } = await params;
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
    const store = getPromptJobStore();
    const existing = findTaskWorkerJob(projectId);

    if (!existing) {
      return NextResponse.json({ error: "Task worker not found" }, { status: 404 });
    }

    // Pause instead of deleting since it's a built-in job
    const job = store.updateJob(existing.id, { state: "paused" });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Failed to disable task worker:", error);
    return NextResponse.json(
      { error: "Failed to disable task worker", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
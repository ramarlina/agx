import { NextRequest, NextResponse } from "next/server";
import { loadProjectObjectiveContext } from "../../_shared";
import { ensureObjectiveWorkerJob } from "@/src/prompt-scheduler/objective-worker-job";
import { getPromptJobStore } from "@/src/prompt-scheduler/get-store";
import { requestPromptJobPump } from "@/src/prompt-scheduler/processor";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

async function resolveParams(params: RouteContext["params"]) {
  const resolved = await params;
  const projectId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
  const objectiveId =
    typeof resolved?.objectiveId === "string" ? resolved.objectiveId.trim() : "";
  if (!projectId || !objectiveId) return null;
  return { projectId, objectiveId };
}

/** POST: Ensure the built-in worker job exists for this objective */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const objectiveContext = await loadProjectObjectiveContext(
      resolved.projectId,
      resolved.objectiveId,
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const job = ensureObjectiveWorkerJob({
      projectId: resolved.projectId,
      objectiveId: objectiveContext.objective.id,
      objectiveKey: objectiveContext.objective.key,
    });

    return NextResponse.json({ job });
  } catch (error) {
    logger.error("Failed to ensure objective worker job", logger.formatError(error));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to ensure worker job" },
      { status: 500 },
    );
  }
}

/** PUT: Trigger an immediate run of the objective worker ("Work on objective") */
export async function PUT(_request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const objectiveContext = await loadProjectObjectiveContext(
      resolved.projectId,
      resolved.objectiveId,
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    // Ensure the worker job exists (lazy creation)
    const job = ensureObjectiveWorkerJob({
      projectId: resolved.projectId,
      objectiveId: objectiveContext.objective.id,
      objectiveKey: objectiveContext.objective.key,
    });

    // Create an immediate run
    const store = getPromptJobStore();
    const run = store.createRun(job.id);
    requestPromptJobPump();

    return NextResponse.json({ job, run });
  } catch (error) {
    logger.error("Failed to trigger objective worker", logger.formatError(error));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to trigger worker" },
      { status: 500 },
    );
  }
}

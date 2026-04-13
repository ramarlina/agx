import { NextRequest, NextResponse } from "next/server";
import { getPromptJobStore } from "@/src/prompt-scheduler/get-store";
import { upsertProjectObjective } from "@/lib/project-objectives";
import type { PromptJobExecutionMode } from "@/src/prompt-scheduler/types";
import {
  loadProjectObjectiveContext,
  persistProjectObjectiveWorkspace,
  readOptionalString,
} from "../../_shared";
import { requestPromptJobPump } from "@/src/prompt-scheduler/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

async function resolveParams(params: RouteContext["params"]) {
  const resolved = await params;
  const projectId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
  const objectiveId =
    typeof resolved?.objectiveId === "string" ? resolved.objectiveId.trim() : "";

  if (!projectId || !objectiveId) {
    return null;
  }

  return { projectId, objectiveId };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const objectiveContext = await loadProjectObjectiveContext(
      resolved.projectId,
      resolved.objectiveId
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const store = getPromptJobStore();
    const jobs = store.listJobs({
      projectId: resolved.projectId,
      objectiveId: objectiveContext.objective.id,
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to load objective scheduled tasks:", error);
    return NextResponse.json(
      { error: "Failed to load objective scheduled tasks" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const objectiveContext = await loadProjectObjectiveContext(
      resolved.projectId,
      resolved.objectiveId
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: "Invalid scheduled task payload" },
        { status: 400 }
      );
    }

    const body = rawBody as Record<string, unknown>;
    const executionMode: PromptJobExecutionMode = "prompt";
    const title =
      readOptionalString(body.name) ?? `Work on ${objectiveContext.objective.title}`;
    const prompt = readOptionalString(body.prompt);
    const cadence = readOptionalString(body.cadence) ?? '';
    const condition = readOptionalString(body.condition) ?? '';

    if (!prompt) {
      return NextResponse.json(
        { error: "Scheduled task prompt is required" },
        { status: 400 }
      );
    }

    if (!cadence) {
      return NextResponse.json(
        {
          error:
            "A cadence is required before a scheduled task can be created for this objective.",
        },
        { status: 400 }
      );
    }

    if (!objectiveContext.objective.teamId) {
      return NextResponse.json(
        {
          error:
            "Assign a team to this objective before creating scheduled tasks.",
        },
        { status: 400 }
      );
    }

    const store = getPromptJobStore();
    const job = store.createJob({
      name: title,
      prompt,
      projectId: resolved.projectId,
      objectiveId: objectiveContext.objective.id,
      objectiveKey: objectiveContext.objective.key,
      executionMode,
      agentId: readOptionalString(body.agentId),
      provider: readOptionalString(body.provider) ?? "claude",
      model: readOptionalString(body.model),
      cliArgs: readOptionalString(body.cliArgs),
      cadence,
      overlapPolicy:
        body.overlapPolicy === "skip" ||
        body.overlapPolicy === "queue" ||
        body.overlapPolicy === "allow"
          ? body.overlapPolicy
          : undefined,
      catchUpPolicy:
        body.catchUpPolicy === "fire_once" ||
        body.catchUpPolicy === "replay_all" ||
        body.catchUpPolicy === "skip"
          ? body.catchUpPolicy
          : undefined,
      cancelCheckSec:
        typeof body.cancelCheckSec === "number" && Number.isFinite(body.cancelCheckSec)
          ? body.cancelCheckSec
          : undefined,
      condition: condition || undefined,
    });

    const nextObjective = {
      ...objectiveContext.objective,
      updatedAt: new Date().toISOString(),
    };

    const updatedProject = await persistProjectObjectiveWorkspace({
      projectId: resolved.projectId,
      currentMetadata: objectiveContext.project.metadata,
      workspace: upsertProjectObjective(objectiveContext.workspace, nextObjective),
    });

    if (!updatedProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Kick off the first run immediately so the user doesn't have to wait
    // for the next cron tick.
    store.createRun(job.id);
    requestPromptJobPump();

    return NextResponse.json({ job, objective: nextObjective }, { status: 201 });
  } catch (error) {
    console.error("Failed to create objective scheduled task:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create objective scheduled task",
      },
      { status: 500 }
    );
  }
}

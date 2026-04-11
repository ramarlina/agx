import { NextRequest, NextResponse } from "next/server";
import {
  generateProjectObjectiveKey,
  upsertProjectObjective,
} from "@/lib/project-objectives";
import {
  findObjectiveAssignedToTeam,
  loadProjectObjectiveContext,
  persistProjectObjectiveWorkspace,
  readNullableString,
  readOptionalString,
  readStringArray,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

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

    return NextResponse.json({ objective: objectiveContext.objective });
  } catch (error) {
    console.error("Failed to load objective:", error);
    return NextResponse.json({ error: "Failed to load objective" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
      return NextResponse.json({ error: "Invalid objective payload" }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    const {
      project,
      workspace,
      objective,
    } = objectiveContext;

    const title = readOptionalString(body.title);
    if (body.title !== undefined && !title) {
      return NextResponse.json(
        { error: "Objective title cannot be empty" },
        { status: 400 }
      );
    }

    const teamId = readOptionalString(body.teamId);
    if (body.teamId !== undefined && !teamId) {
      return NextResponse.json({ error: "Team is required" }, { status: 400 });
    }
    if (teamId) {
      const conflictingObjective = findObjectiveAssignedToTeam(
        workspace,
        teamId,
        objective.id
      );
      if (conflictingObjective) {
        return NextResponse.json(
          {
            error: `Team is already assigned to "${conflictingObjective.title}".`,
          },
          { status: 400 }
        );
      }
    }

    const chatSessionVersion = readOptionalNonNegativeInteger(body.chatSessionVersion);
    if (body.chatSessionVersion !== undefined && chatSessionVersion === undefined) {
      return NextResponse.json(
        { error: "chatSessionVersion must be a non-negative integer" },
        { status: 400 }
      );
    }

    const nextTitle = title ?? objective.title;
    const nextKey =
      body.key !== undefined
        ? generateProjectObjectiveKey(
            readOptionalString(body.key) ?? nextTitle,
            workspace.objectives,
            objective.id
          )
        : objective.key;

    const scheduledTaskIds = readStringArray(body.scheduledTaskIds);
    const nextObjective = {
      ...objective,
      title: nextTitle,
      teamId: teamId ?? objective.teamId,
      key: nextKey,
      threadId:
        body.threadId !== undefined
          ? readNullableString(body.threadId) ?? null
          : objective.threadId,
      chatSessionVersion: chatSessionVersion ?? objective.chatSessionVersion,
      scheduledTaskIds: scheduledTaskIds ?? objective.scheduledTaskIds,
      summary:
        body.summary !== undefined
          ? readNullableString(body.summary) ?? ""
          : objective.summary,
      cadence:
        body.cadence !== undefined
          ? readNullableString(body.cadence) ?? ""
          : objective.cadence,
      condition:
        body.condition !== undefined
          ? readNullableString(body.condition) ?? ""
          : objective.condition,
      updatedAt: new Date().toISOString(),
    };

    const updatedProject = await persistProjectObjectiveWorkspace(
      resolved.projectId,
      project.metadata,
      upsertProjectObjective(workspace, nextObjective)
    );

    if (!updatedProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ objective: nextObjective });
  } catch (error) {
    console.error("Failed to update objective:", error);
    return NextResponse.json({ error: "Failed to update objective" }, { status: 500 });
  }
}

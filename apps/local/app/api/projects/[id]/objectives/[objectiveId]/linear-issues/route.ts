import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { ensureLinearIssueCache, listLinearIssueSummaries } from "@/lib/linear-issues";
import { getLinearClient } from "@/lib/linear-client";
import {
  loadProjectObjectiveContext,
  readOptionalString,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

function matchesObjectiveLabel(label: string, objectiveKey: string): boolean {
  return label.trim().toLowerCase() === objectiveKey.trim().toLowerCase();
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

    const client = getLinearClient();
    const pullResult = await ensureLinearIssueCache({
      projectSlug: objectiveContext.project.slug,
    });
    const { issues } = await listLinearIssueSummaries({ limit: 500 });
    const objectiveIssues = issues.filter((issue) =>
      (issue.labels ?? []).some((label) =>
        matchesObjectiveLabel(label, objectiveContext.objective.key)
      )
    );

    return NextResponse.json({
      connected: Boolean(client),
      label: objectiveContext.objective.key,
      issues: objectiveIssues,
      refreshedAt: pullResult?.pulledAt ?? null,
    });
  } catch (error) {
    console.error("Failed to load objective Linear issues:", error);
    return NextResponse.json(
      { error: "Failed to load objective Linear issues" },
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

    const client = getLinearClient();
    if (!client) {
      return NextResponse.json({ error: "Linear is not connected" }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: "Invalid Linear issue payload" },
        { status: 400 }
      );
    }

    const body = rawBody as Record<string, unknown>;
    const title = readOptionalString(body.title);
    if (!title) {
      return NextResponse.json(
        { error: "Linear issue title is required" },
        { status: 400 }
      );
    }

    const linearTeams = await client.teams();
    let linearTeamId = readOptionalString(body.teamId);
    if (!linearTeamId) {
      const objectiveTeam = objectiveContext.objective.teamId
        ? await db.getTeam(objectiveContext.objective.teamId)
        : null;
      const matchedTeam =
        objectiveTeam?.name
          ? linearTeams.find(
              (team) =>
                team.name.trim().toLowerCase() ===
                objectiveTeam.name.trim().toLowerCase()
            ) ?? null
          : null;

      if (!matchedTeam) {
        return NextResponse.json(
          {
            error:
              "A matching Linear team could not be resolved for this objective. Pass a teamId explicitly.",
            availableTeams: linearTeams,
          },
          { status: 400 }
        );
      }

      linearTeamId = matchedTeam.id;
    }

    const labelName = objectiveContext.objective.key;
    const labels = await client.issueLabels();
    let objectiveLabel =
      labels.find(
        (label) =>
          matchesObjectiveLabel(label.name, labelName) &&
          (!label.teamId || label.teamId === linearTeamId)
      ) ?? null;

    if (!objectiveLabel) {
      objectiveLabel = await client.createIssueLabel({
        name: labelName,
        description: `Tracks work for objective "${objectiveContext.objective.title}".`,
        color: readOptionalString(body.labelColor) ?? "#2563eb",
        teamId: linearTeamId,
      });
    }

    const issue = await client.createIssue({
      title,
      description:
        readOptionalString(body.description) ??
        (objectiveContext.objective.summary.trim() || undefined),
      teamId: linearTeamId,
      assigneeId: readOptionalString(body.assigneeId),
      cycleId: readOptionalString(body.cycleId),
      projectId: readOptionalString(body.projectId),
      stateId: readOptionalString(body.stateId),
      priority:
        typeof body.priority === "number" && Number.isFinite(body.priority)
          ? Math.trunc(body.priority)
          : undefined,
      labelIds: [objectiveLabel.id],
    });

    await ensureLinearIssueCache({
      refresh: true,
      projectSlug: objectiveContext.project.slug,
    });

    return NextResponse.json(
      {
        issue,
        label: objectiveLabel.name,
        teamId: linearTeamId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create objective Linear issue:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create objective Linear issue",
      },
      { status: 500 }
    );
  }
}

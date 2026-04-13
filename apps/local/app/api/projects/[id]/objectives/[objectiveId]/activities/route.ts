import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadProjectObjectiveContext } from "../../_shared";
import { getActivityRepository } from "@/src/objectives/activities";
import type { ObjectiveActivityType, ObjectiveActivityFile } from "@/src/objectives/activities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

const VALID_TYPES = new Set<ObjectiveActivityType>(["metric-check", "status-update", "milestone", "note"]);

async function resolveParams(params: RouteContext["params"]) {
  const resolved = await params;
  const projectId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
  const objectiveId =
    typeof resolved?.objectiveId === "string" ? resolved.objectiveId.trim() : "";

  if (!projectId || !objectiveId) return null;
  return { projectId, objectiveId };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const objectiveContext = await loadProjectObjectiveContext(
      resolved.projectId,
      resolved.objectiveId,
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const { project, objective } = objectiveContext;
    const slug = project.slug ?? project.id;
    const repo = getActivityRepository(slug, objective.key);

    const url = request.nextUrl;
    const typeParam = url.searchParams.get("type");
    const type = typeParam && VALID_TYPES.has(typeParam as ObjectiveActivityType)
      ? (typeParam as ObjectiveActivityType)
      : undefined;

    const result = repo.list({
      type,
      source: url.searchParams.get("source") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      page: parseInt(url.searchParams.get("page") ?? "", 10) || undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "", 10) || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load activities:", error);
    return NextResponse.json({ error: "Failed to load activities" }, { status: 500 });
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
      resolved.objectiveId,
    );
    if (!objectiveContext) {
      return NextResponse.json({ error: "Objective not found" }, { status: 404 });
    }

    const body = await request.json();
    const type = body?.type as string;
    const content = typeof body?.body === "string" ? body.body.trim() : "";

    if (!type || !VALID_TYPES.has(type as ObjectiveActivityType)) {
      return NextResponse.json(
        { error: "Invalid type. Must be one of: metric-check, status-update, milestone, note" },
        { status: 400 },
      );
    }
    if (!content) {
      return NextResponse.json({ error: "Body is required" }, { status: 400 });
    }

    const { project, objective } = objectiveContext;
    const slug = project.slug ?? project.id;
    const repo = getActivityRepository(slug, objective.key);

    const activity: ObjectiveActivityFile = {
      id: randomUUID(),
      source: "manual",
      objectiveLabel: objective.key,
      createdAt: new Date().toISOString(),
      type: type as ObjectiveActivityType,
      body: content,
    };

    repo.append(activity);

    return NextResponse.json(activity, { status: 201 });
  } catch (error) {
    console.error("Failed to create activity:", error);
    return NextResponse.json({ error: "Failed to create activity" }, { status: 500 });
  }
}

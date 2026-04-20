import { NextRequest, NextResponse } from "next/server";
import { loadProjectObjectiveContext } from "../../_shared";
import { readProgram, writeProgram } from "@/src/objectives/program";
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

export async function GET(_request: NextRequest, context: RouteContext) {
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
    const program = readProgram(slug, objective.key);

    return NextResponse.json({ program });
  } catch (error) {
    logger.error("Failed to load program", logger.formatError(error));
    return NextResponse.json({ error: "Failed to load program" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
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

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid program payload" }, { status: 400 });
    }
    const body = rawBody as Record<string, unknown>;
    const content = typeof body.content === "string" ? body.content : "";

    const { project, objective } = objectiveContext;
    const slug = project.slug ?? project.id;
    const program = writeProgram(slug, objective.key, content);

    return NextResponse.json({ program });
  } catch (error) {
    logger.error("Failed to save program", logger.formatError(error));
    return NextResponse.json({ error: "Failed to save program" }, { status: 500 });
  }
}

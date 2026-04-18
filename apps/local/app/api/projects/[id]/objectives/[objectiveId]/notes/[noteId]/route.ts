import { NextRequest, NextResponse } from "next/server";
import { loadProjectObjectiveContext } from "../../../_shared";
import { getNoteRepository } from "@/src/objectives/notes";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string; noteId: string }> };

async function resolveParams(params: RouteContext["params"]) {
  const resolved = await params;
  const projectId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
  const objectiveId =
    typeof resolved?.objectiveId === "string" ? resolved.objectiveId.trim() : "";
  const noteId =
    typeof resolved?.noteId === "string" ? resolved.noteId.trim() : "";

  if (!projectId || !objectiveId || !noteId) return null;
  return { projectId, objectiveId, noteId };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
    const repo = getNoteRepository(slug, objective.key);
    const note = repo.findById(resolved.noteId);

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ note });
  } catch (error) {
    logger.error("Failed to load note", logger.formatError(error));
    return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
      return NextResponse.json({ error: "Invalid note payload" }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    const patch: { title?: string; body?: string } = {};

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return NextResponse.json({ error: "Note title cannot be empty" }, { status: 400 });
      }
      patch.title = title;
    }

    if (body.body !== undefined) {
      patch.body = typeof body.body === "string" ? body.body : "";
    }

    const { project, objective } = objectiveContext;
    const slug = project.slug ?? project.id;
    const repo = getNoteRepository(slug, objective.key);
    const updated = repo.update(resolved.noteId, patch);

    if (!updated) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ note: updated });
  } catch (error) {
    logger.error("Failed to update note", logger.formatError(error));
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const resolved = await resolveParams(context.params);
    if (!resolved) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
    const repo = getNoteRepository(slug, objective.key);
    const deleted = repo.delete(resolved.noteId);

    if (!deleted) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error("Failed to delete note", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}

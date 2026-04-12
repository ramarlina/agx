import { NextRequest, NextResponse } from "next/server";
import { loadProjectObjectiveContext } from "../../_shared";
import { getNoteRepository } from "@/src/objectives/notes";
import type { ObjectiveNoteFile } from "@/src/objectives/notes";

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
    const repo = getNoteRepository(slug, objective.key);

    const url = request.nextUrl;
    const result = repo.list({
      page: parseInt(url.searchParams.get("page") ?? "", 10) || undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "", 10) || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load notes:", error);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
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

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid note payload" }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const noteBody = typeof body.body === "string" ? body.body : "";

    if (!title) {
      return NextResponse.json({ error: "Note title is required" }, { status: 400 });
    }

    const { project, objective } = objectiveContext;
    const slug = project.slug ?? project.id;
    const repo = getNoteRepository(slug, objective.key);

    const now = new Date().toISOString();
    const note: ObjectiveNoteFile = {
      id: `note_${Math.random().toString(36).slice(2, 10)}`,
      title,
      objectiveId: objective.id,
      createdAt: now,
      updatedAt: now,
      body: noteBody,
    };

    repo.append(note);

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Failed to create note:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeNote, upsertKnowledgeNote, type KnowledgeNoteScope } from "@/lib/knowledge-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/knowledge-notes?scope=project&subjectId=xxx */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") as KnowledgeNoteScope | null;
    const subjectId = url.searchParams.get("subjectId");

    if (!scope || !subjectId) {
      return NextResponse.json({ error: "scope and subjectId are required" }, { status: 400 });
    }

    const note = getKnowledgeNote(scope, subjectId);
    return NextResponse.json({ note });
  } catch (error) {
    console.error("Error fetching knowledge note:", error);
    return NextResponse.json({ error: "Failed to fetch knowledge note" }, { status: 500 });
  }
}

/** PUT /api/knowledge-notes — update a knowledge note's content */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = body.scope as KnowledgeNoteScope | undefined;
    const subjectId = typeof body.subjectId === "string" ? body.subjectId.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";

    if (!scope || !subjectId) {
      return NextResponse.json({ error: "scope and subjectId are required" }, { status: 400 });
    }

    const { note, changed } = upsertKnowledgeNote({
      scope,
      subjectId,
      content,
      changeSummary: "Manual edit",
      sourceType: "task_completion",
      sourceId: "manual-edit",
      metadata: { manual_edit: true },
    });

    return NextResponse.json({ note, changed });
  } catch (error) {
    console.error("Error updating knowledge note:", error);
    return NextResponse.json({ error: "Failed to update knowledge note" }, { status: 500 });
  }
}

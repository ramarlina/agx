import { NextRequest, NextResponse } from "next/server";
import { getProjectThreads, addProjectThread, removeProjectThread } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/threads — list threads scoped to a project */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const threads = await getProjectThreads(projectId);
    return NextResponse.json({ threads });
  } catch (error) {
    console.error("Error fetching project threads:", error);
    return NextResponse.json({ error: "Failed to fetch project threads" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/threads — link a thread to a project */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";

    if (!threadId) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }

    const thread = await addProjectThread(projectId, threadId);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    console.error("Error adding thread to project:", error);
    return NextResponse.json({ error: "Failed to add thread to project" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/threads?threadId=<id> — unlink a thread from a project */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const threadId = new URL(request.url).searchParams.get("threadId");
    if (!threadId) {
      return NextResponse.json({ error: "threadId query param is required" }, { status: 400 });
    }

    await removeProjectThread(projectId, threadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error removing thread from project:", error);
    return NextResponse.json({ error: "Failed to remove thread from project" }, { status: 500 });
  }
}

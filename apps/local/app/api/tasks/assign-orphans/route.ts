import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";

async function resolveUserId(_request: NextRequest): Promise<string | null> {
  return LOCAL_USER.id;
}

// POST /api/tasks/assign-orphans - Assign tasks with missing project_id to a project
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch((err) => { console.error('[assign-orphans] body parse failed:', err); return null; });
    const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }

    const result = await db.assignOrphanTasksToProject(projectId, userId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error assigning orphan tasks:", error);
    const message = error instanceof Error ? error.message : "Failed to assign orphan tasks";
    if (message === "Project not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to assign orphan tasks" }, { status: 500 });
  }
}

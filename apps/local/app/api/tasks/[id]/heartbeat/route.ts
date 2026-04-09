import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";

// POST /api/tasks/[id]/heartbeat - temporal no-op keepalive for daemon compatibility
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = createAdminDbClient();
    const user = { id: LOCAL_USER.id };

    const { id } = await params;

    const { data: task, error: taskError } = await db
      .from("tasks")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await db
      .from("tasks")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, task: { id: task.id, status: task.status } });
  } catch (error) {
    console.error("Error updating task heartbeat:", error);
    return NextResponse.json({ error: "Failed to update heartbeat" }, { status: 500 });
  }
}

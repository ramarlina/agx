import { NextRequest, NextResponse } from "next/server";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { assignTasksToGroup, removeTaskFromGroup } from "@/lib/task-groups-db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getSQLiteDb();
    const { id } = await params;
    const body = await request.json();
    const { task_ids } = body;
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      return NextResponse.json({ error: "task_ids array is required" }, { status: 400 });
    }
    assignTasksToGroup(db, id, task_ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error assigning tasks to group:", error);
    return NextResponse.json({ error: "Failed to assign tasks" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getSQLiteDb();
    const { id } = await params;
    const taskId = new URL(request.url).searchParams.get("task_id");
    if (!taskId) {
      return NextResponse.json({ error: "task_id query param is required" }, { status: 400 });
    }
    removeTaskFromGroup(db, id, taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error removing task from group:", error);
    return NextResponse.json({ error: "Failed to remove task" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { createTaskGroup, listTaskGroups } from "@/lib/task-groups-db";

export async function GET(request: NextRequest) {
  try {
    const db = getSQLiteDb();
    const projectId = new URL(request.url).searchParams.get("project_id");
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }
    const groups = listTaskGroups(db, projectId);
    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Error listing task groups:", error);
    return NextResponse.json({ error: "Failed to list task groups" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getSQLiteDb();
    const body = await request.json();
    const { project_id, name, task_ids } = body;
    if (!project_id) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }
    const group = createTaskGroup(db, {
      projectId: project_id,
      name: name || "Untitled",
      taskIds: Array.isArray(task_ids) ? task_ids : [],
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.error("Error creating task group:", error);
    return NextResponse.json({ error: "Failed to create task group" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { updateTaskGroup, deleteTaskGroup } from "@/lib/task-groups-db";
import { logger } from "@/lib/logger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getSQLiteDb();
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.position !== undefined) updates.position = body.position;
    if (body.collapsed !== undefined) updates.collapsed = body.collapsed ? 1 : 0;
    const group = updateTaskGroup(db, id, updates);
    return NextResponse.json({ group });
  } catch (error) {
    logger.error("Error updating task group", logger.formatError(error));
    return NextResponse.json({ error: "Failed to update task group" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getSQLiteDb();
    const { id } = await params;
    deleteTaskGroup(db, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting task group", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete task group" }, { status: 500 });
  }
}

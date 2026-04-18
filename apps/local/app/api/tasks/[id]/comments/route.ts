import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { resolveTaskConfig } from "@/lib/db";
import { buildTaskContext } from "@/lib/task-context";
import { LOCAL_USER } from "@/lib/auth-mode";
import { logger } from "@/lib/logger";

// GET /api/tasks/[id]/comments - Get comments for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id } = await params;
    const task = await db.getTask(id, userId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const comments = await db.getTaskComments(id);
    return NextResponse.json({ comments });
  } catch (error) {
    logger.error("Error fetching comments", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
  }
}

// POST /api/tasks/[id]/comments - Add a comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const task = await db.getTask(id, userId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const comment = await db.addTaskComment(id, content, "user", userId);

    // Recompute context and ensure comments_digest is signed
    const context = await buildTaskContext(task);
    const { comments_digest: commentsDigest, stage_config } = context;
    const resolvedConfig = resolveTaskConfig(task, stage_config, context.user_settings);

    return NextResponse.json(
      {
        comment,
        comments_digest: commentsDigest,
        context: { ...context, ...resolvedConfig },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Error adding comment", logger.formatError(error));
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

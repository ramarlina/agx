import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { resolveTaskConfig } from "@/lib/db";
import { LOCAL_USER } from "@/lib/auth-mode";
import { buildTaskContext } from "@/lib/task-context";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const user = { id: LOCAL_USER.id };

    const { id, commentId } = await params;

    const task = await db.getTask(id, user.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await db.deleteTaskComment(commentId, user.id);

    // Recompute context and ensure comments_digest is signed
    const context = await buildTaskContext(task);
    const { comments_digest: commentsDigest, stage_config } = context;
    const resolvedConfig = resolveTaskConfig(task, stage_config, context.user_settings);
    return NextResponse.json({ success: true, comments_digest: commentsDigest });
  } catch (error) {
    logger.error("Error deleting comment", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}

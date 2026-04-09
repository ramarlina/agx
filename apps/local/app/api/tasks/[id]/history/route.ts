import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { db } from "@/lib/db-instance";

// DELETE /api/tasks/[id]/history - Clear task comments and logs
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminDb = createAdminDbClient();
    const user = { id: LOCAL_USER.id };

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const target = (searchParams.get("target") || "both").toLowerCase();
    if (!["both", "comments", "logs"].includes(target)) {
      return NextResponse.json({ error: "Invalid target. Use both|comments|logs" }, { status: 400 });
    }
    const task = await db.getTask(id, user.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let deletedComments: Array<{ id: string }> = [];
    let deletedLogs: Array<{ id: string }> = [];

    if (target === "both" || target === "comments") {
      const { data, error: commentsError } = await adminDb
        .from("task_comments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("task_id", id)
        .is("deleted_at", null)
        .select("id");
      if (commentsError) throw commentsError;
      deletedComments = Array.isArray(data) ? data : [];
    }

    if (target === "both" || target === "logs") {
      const { data, error: logsError } = await adminDb
        .from("task_logs")
        .delete()
        .eq("task_id", id)
        .select("id");
      if (logsError) throw logsError;
      deletedLogs = Array.isArray(data) ? data : [];
    }

    return NextResponse.json({
      success: true,
      task_id: id,
      target,
      deleted: {
        comments: deletedComments.length,
        logs: deletedLogs.length,
      },
    });
  } catch (error) {
    console.error("Error clearing task history:", error);
    return NextResponse.json({ error: "Failed to clear task history" }, { status: 500 });
  }
}

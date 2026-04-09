import { createAdminDbClient } from "@/lib/db-adapter";
import { parseFrontmatter } from "@/lib/db";
import { db as dbAdapter } from "@/lib/db-instance";
import { buildMarkdownWithFrontmatter } from "@/lib/orchestration/frontmatter";

type GraphRunnableTaskStatus = "queued" | "in_progress";

interface SyncGraphTaskProgressInput {
  taskId: string;
  status: GraphRunnableTaskStatus;
  userId?: string;
  nowIso?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  clearError?: boolean;
}

export async function syncTaskProgressForGraphExecution(
  input: SyncGraphTaskProgressInput,
): Promise<void> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const db = createAdminDbClient();

  const task = await dbAdapter.getTask(input.taskId, input.userId);
  const payload: Record<string, unknown> = {
    status: input.status,
    stage: "PROGRESS",
    updated_at: nowIso,
  };

  if (Object.prototype.hasOwnProperty.call(input, "startedAt")) {
    payload.started_at = input.startedAt ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "completedAt")) {
    payload.completed_at = input.completedAt ?? null;
  }

  if (task) {
    const { frontmatter, body } = parseFrontmatter(String(task.content || ""));
    frontmatter.status = input.status;
    frontmatter.stage = "PROGRESS";
    if (input.clearError) {
      delete frontmatter.error;
    }
    payload.content = buildMarkdownWithFrontmatter(frontmatter, body);
  }

  let query = db
    .from("tasks")
    .update(payload)
    .eq("id", input.taskId);
  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  const { error } = await query;
  if (error) {
    throw error;
  }
}

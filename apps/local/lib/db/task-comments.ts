import { createAdminDbClient } from "../db-adapter";
import type { TaskComment } from "./types";

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("task_comments")
    .select("*")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function addTaskComment(
  taskId: string,
  content: string,
  authorType: "user" | "agent",
  authorId?: string
): Promise<TaskComment> {
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("task_comments")
    .insert({ task_id: taskId, content, author_type: authorType, author_id: authorId ?? null })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTaskComment(commentId: string, userId: string): Promise<void> {
  const db = createAdminDbClient();

  const { data: comment, error: fetchError } = await db
    .from("task_comments")
    .select("author_id, author_type")
    .eq("id", commentId)
    .single();

  if (fetchError) throw fetchError;
  if (!comment) throw new Error("Comment not found");

  if (comment.author_type !== "user" || comment.author_id !== userId) {
    throw new Error("Unauthorized");
  }

  const { error } = await db
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .is("deleted_at", null);

  if (error) throw error;
}


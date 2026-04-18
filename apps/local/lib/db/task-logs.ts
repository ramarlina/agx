import { createAdminDbClient } from "../db-adapter";
import type { TaskLog } from "./types";

export async function getTaskLogs(
  taskId: string,
  options: { limit?: number; tail?: number; after?: string; nodeId?: string } = {}
): Promise<TaskLog[]> {
  const db = createAdminDbClient();

  const limit = Math.max(1, Math.min(2000, Number(options.limit ?? options.tail ?? 500)));
  const after = typeof options.after === "string" && options.after.trim() ? options.after.trim() : null;
  const tail = after ? null : (options.tail === undefined ? limit : Number(options.tail));
  const useTail = tail !== null && Number.isFinite(tail) && tail > 0;

  let query = db
    .from("task_logs")
    .select("*")
    .eq("task_id", taskId);

  if (options.nodeId) {
    query = query.eq("node_id", options.nodeId);
  }

  if (after) {
    query = query
      .gt("created_at", after)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
  } else if (useTail) {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
  } else {
    query = query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  if (after) return rows;
  if (useTail) return rows.slice().reverse();
  return rows;
}

export async function addTaskLog(taskId: string, content: string, logType?: string, nodeId?: string): Promise<TaskLog> {
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("task_logs")
    .insert({ task_id: taskId, content, log_type: logType, ...(nodeId ? { node_id: nodeId } : {}) })
    .select()
    .single();

  if (error) throw error;
  return data;
}


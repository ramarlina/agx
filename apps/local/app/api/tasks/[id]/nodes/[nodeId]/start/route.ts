import { NextRequest } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { ErrorResponseSchema, StartNodeRequestSchema } from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeNodeId,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { applyNodeStatusMutation } from "@/src/graph/node-ops";
import { getGraph } from "@/src/graph/store";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string; nodeId: string }>;
}

function isPlanNode(nodeId: string, title: string): boolean {
  return nodeId === "plan" || /generate.*execution.*plan/i.test(title);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: taskId, nodeId } = await params;
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedNodeId = normalizeNodeId(nodeId);
  if (!normalizedTaskId || !normalizedNodeId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid taskId or nodeId" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, StartNodeRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.data;

  // For blocked nodes, transition to pending (queued) so the daemon picks it up
  const graph = await getGraph(normalizedTaskId);
  const node = graph?.nodes[normalizedNodeId];
  const currentStatus = graph?.nodes[normalizedNodeId]?.status;
  const isDonePlan = currentStatus === "done"
    && node?.type === "work"
    && isPlanNode(normalizedNodeId, String((node as { title?: unknown }).title || ""));
  const targetStatus = (currentStatus === "blocked" || isDonePlan) ? "pending" as const : "running" as const;

  const response = await applyNodeStatusMutation({
    request,
    taskId: normalizedTaskId,
    nodeId: normalizedNodeId,
    action: "node_start",
    requestedProjectId: body.projectId ?? body.project_id,
    ifMatchGraphVersion: body.ifMatchGraphVersion,
    targetStatus,
    reason: currentStatus === "blocked"
      ? "manual unblock and requeue"
      : isDonePlan
        ? "manual plan rerun and requeue"
        : "manual node start",
    resetWorkAttempts: true,
    patch: targetStatus === "running"
      ? { startedAt: body.startedAt ?? new Date().toISOString() }
      : {},
  });

  // Manual node starts should wake daemon execution.
  if (response.status >= 200 && response.status < 300) {
    try {
      const db = createAdminDbClient();
      const now = new Date().toISOString();
      await syncTaskProgressForGraphExecution({
        taskId: normalizedTaskId,
        status: "queued",
        nowIso: now,
        completedAt: null,
        clearError: true,
      });
      await db
        .from("execution_graphs")
        .update({
          execution_state: "running",
          updated_at: now,
        })
        .eq("task_id", normalizedTaskId);
    } catch (error) {
      logger.error("Failed to requeue task after node start", logger.formatError(error));
    }
  }

  return response;
}

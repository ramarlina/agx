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
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";

interface RouteParams {
  params: Promise<{ id: string; nodeId: string }>;
}

/**
 * POST /api/tasks/[id]/nodes/[nodeId]/resume
 * 
 * Resume a paused node execution.
 */
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

  const response = await applyNodeStatusMutation({
    request,
    taskId: normalizedTaskId,
    nodeId: normalizedNodeId,
    action: "node_resume",
    requestedProjectId: body.projectId ?? body.project_id,
    ifMatchGraphVersion: body.ifMatchGraphVersion,
    targetStatus: "running",
    reason: "manual node resume",
    resetWorkAttempts: true,
    allowedFromStatuses: ["paused", "stopped"],
    patch: {
      // Resume timestamp - don't reset startedAt
    },
  });

  // Manual node resume/re-run should wake daemon execution.
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
      console.error("Failed to requeue task after node resume:", error);
    }
  }

  return response;
}

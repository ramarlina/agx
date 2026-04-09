import { NextRequest } from "next/server";

import { ErrorResponseSchema, StartNodeRequestSchema } from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeNodeId,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { applyNodeStatusMutation } from "@/src/graph/node-ops";

interface RouteParams {
  params: Promise<{ id: string; nodeId: string }>;
}

/**
 * POST /api/tasks/[id]/nodes/[nodeId]/stop
 *
 * Manual stop signal for a running node.
 * Transitions the node into `blocked`.
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

  return applyNodeStatusMutation({
    request,
    taskId: normalizedTaskId,
    nodeId: normalizedNodeId,
    action: "node_stop",
    requestedProjectId: body.projectId ?? body.project_id,
    ifMatchGraphVersion: body.ifMatchGraphVersion,
    targetStatus: "blocked",
    reason: "manual node stop",
    allowedFromStatuses: ["running"],
    patch: {
      completedAt: new Date().toISOString(),
    },
  });
}

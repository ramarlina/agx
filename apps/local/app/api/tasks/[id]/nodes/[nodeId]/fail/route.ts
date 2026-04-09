import { NextRequest } from "next/server";

import { ErrorResponseSchema, FailNodeRequestSchema } from "@/src/graph/api-schemas";
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

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: taskId, nodeId } = await params;
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedNodeId = normalizeNodeId(nodeId);
  if (!normalizedTaskId || !normalizedNodeId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid taskId or nodeId" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, FailNodeRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.data;

  return applyNodeStatusMutation({
    request,
    taskId: normalizedTaskId,
    nodeId: normalizedNodeId,
    action: "node_fail",
    requestedProjectId: body.projectId ?? body.project_id,
    ifMatchGraphVersion: body.ifMatchGraphVersion,
    targetStatus: "failed",
    reason: body.error,
    patch: {
      completedAt: body.completedAt ?? new Date().toISOString(),
      metrics: body.metrics,
    },
  });
}

import { NextRequest } from "next/server";

import {
  ErrorResponseSchema,
  GraphMetricsResponseSchema,
} from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeTaskId,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import { getGraph } from "@/src/graph/store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "create",
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  let completedNodes = 0;
  let failedNodes = 0;
  let totalTokensUsed = 0;
  let totalLatencyMs = 0;
  let estimatedMinutes = 0;
  let actualMinutes = 0;
  let passedGateCount = 0;
  let attemptedGateCount = 0;

  for (const node of Object.values(graph.nodes)) {
    if (node.status === "done" || node.status === "passed") {
      completedNodes += 1;
    }
    if (node.status === "failed") {
      failedNodes += 1;
    }

    totalTokensUsed += node.metrics?.tokensUsed ?? 0;
    totalLatencyMs += node.metrics?.latencyMs ?? 0;

    if (node.type === "work") {
      estimatedMinutes += node.estimateMinutes ?? 0;
      actualMinutes += node.actualMinutes ?? 0;
    }

    if (node.type === "gate") {
      if (node.status === "passed") {
        passedGateCount += 1;
        attemptedGateCount += 1;
      } else if (node.status === "failed") {
        attemptedGateCount += 1;
      }
    }
  }

  const replanCount = graph.versionHistory.filter(
    (event) => event.eventType === "replan",
  ).length;
  const gatePassRate = attemptedGateCount > 0 ? passedGateCount / attemptedGateCount : 0;

  return jsonWithSchema(GraphMetricsResponseSchema, {
    graphId: graph.id,
    taskId: graph.taskId,
    currentGraphVersion: graph.graphVersion,
    metrics: {
      totalNodes: Object.keys(graph.nodes).length,
      completedNodes,
      failedNodes,
      totalTokensUsed,
      totalLatencyMs,
      estimatedMinutes,
      actualMinutes,
      replanCount,
      gatePassRate,
    },
  });
}

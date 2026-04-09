import { NextRequest } from "next/server";

import {
  ErrorResponseSchema,
  GraphHistoryResponseSchema,
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

  const history = graph.versionHistory.map((event, index) => {
    const version =
      event.eventType === "replan"
        ? event.toVersion
        : Math.max(2, graph.graphVersion - (graph.versionHistory.length - index - 1));

    if (event.eventType === "replan") {
      return {
        version,
        eventType: event.eventType,
        timestamp: event.timestamp,
        reason: event.reason,
        triggeredBy: event.triggeredBy,
        diff: {
          addedNodes: event.changes.addedNodes,
          removedNodes: event.changes.removedNodes,
          rewiredDeps: event.changes.rewiredDeps,
          estimateDeltas: event.changes.estimateDeltas,
        },
        checkpointNodeId: event.triggeredAtNodeId,
      };
    }

    return {
      version,
      eventType: event.eventType,
      timestamp: event.timestamp,
      reason: event.reason,
      triggeredBy: event.triggeredBy,
      diff: {
        addedNodes: [],
        removedNodes: [],
        rewiredDeps: [],
        estimateDeltas: {},
      },
      checkpointNodeId: event.toCheckpoint,
    };
  });

  return jsonWithSchema(GraphHistoryResponseSchema, {
    graphId: graph.id,
    taskId: graph.taskId,
    currentGraphVersion: graph.graphVersion,
    history,
  });
}

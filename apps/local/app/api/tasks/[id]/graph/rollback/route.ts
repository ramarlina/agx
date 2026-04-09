import { NextRequest } from "next/server";
import { z } from "zod";

import { buildRollbackEvent } from "@/src/graph/audit";
import { ErrorResponseSchema, RollbackRequestSchema } from "@/src/graph/api-schemas";
import {
  graphConflictResponse,
  jsonWithSchema,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import { recordRollback } from "@/src/graph/observability";
import { appendEvent, getGraph, GraphVersionConflictError, updateGraphStructure } from "@/src/graph/store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const RollbackResponseSchema = z.object({
  graphId: z.string().min(1),
  graphVersion: z.number(),
  updatedAt: z.string().min(1),
  checkpoint: z.string().min(1),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, RollbackRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const input = parsedBody.data;

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "rollback",
    requestedProjectId: input.projectId ?? input.project_id,
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }
  if (!graph.nodes[input.toCheckpoint]) {
    return jsonWithSchema(
      ErrorResponseSchema,
      { error: "toCheckpoint does not exist in graph" },
      { status: 400 },
    );
  }

  try {
    const updated = await updateGraphStructure(
      graph.id,
      {
        mode: graph.mode,
        policy: graph.policy,
        doneCriteria: graph.doneCriteria,
      },
      input.ifMatchGraphVersion,
    );

    await appendEvent(
      graph.id,
      buildRollbackEvent({
        actor: authz.actor,
        toCheckpoint: input.toCheckpoint,
        reason: input.reason?.trim() || "rollback requested",
        projectId: authz.projectId,
      }),
    );

    recordRollback();
    return jsonWithSchema(RollbackResponseSchema, {
      graphId: graph.id,
      graphVersion: updated.graphVersion,
      updatedAt: updated.updatedAt,
      checkpoint: input.toCheckpoint,
    });
  } catch (error) {
    if (error instanceof GraphVersionConflictError) {
      return graphConflictResponse(error);
    }

    console.error("Error handling graph rollback:", error);
    return jsonWithSchema(ErrorResponseSchema, { error: "Failed to rollback graph" }, { status: 500 });
  }
}

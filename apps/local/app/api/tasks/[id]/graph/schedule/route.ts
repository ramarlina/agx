import { NextRequest } from "next/server";
import { z } from "zod";

import {
  ErrorResponseSchema,
  GraphEnvelopeResponseSchema,
} from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import {
  activateGraphSchedule,
  deactivateGraphSchedule,
} from "@/src/graph/scheduler";
import {
  getActiveScheduleForRootMessageId,
  getGraph,
  updateGraphStructure,
} from "@/src/graph/store";
import type { ExecutionGraph } from "@/src/graph/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ScheduleRequestSchema = z.object({
  intervalMs: z.number().int().positive().optional().default(60000),
  cronExpr: z.string().trim().min(1).optional(),
  cadence: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  resetNodeIds: z.array(z.string().trim().min(1)).optional(),
  maxRuns: z.number().int().positive().optional(),
  maxConsecutiveFailures: z.number().int().positive().optional(),
  activeUntil: z.string().trim().min(1).optional(),
  rootMessageId: z.string().trim().min(1).optional(),
  ifMatchGraphVersion: z.number().int().positive().optional(),
});

function deriveDefaultResetNodeIds(graph: ExecutionGraph): string[] {
  return Object.entries(graph.nodes)
    .filter(([, node]) => node.type === "function" || node.type === "conditional")
    .map(([nodeId]) => nodeId);
}

function persistGraphSchedule(
  graph: ExecutionGraph,
  ifMatchGraphVersion: number,
): ExecutionGraph | null {
  updateGraphStructure(
    graph.id,
    {
      mode: graph.mode,
      nodes: graph.nodes,
      edges: graph.edges,
      policy: graph.policy,
      doneCriteria: graph.doneCriteria,
      schedule: graph.schedule,
    },
    ifMatchGraphVersion,
  );
  return getGraph(graph.taskId);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, ScheduleRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "update",
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  const body = parsedBody.data;
  if (body.rootMessageId) {
    const active = getActiveScheduleForRootMessageId(body.rootMessageId);
    if (active && active.graphId !== graph.id) {
      return jsonWithSchema(
        ErrorResponseSchema,
        { error: `An active schedule already exists for rootMessageId "${body.rootMessageId}".` },
        { status: 409 },
      );
    }
  }

  const resetNodeIds = body.resetNodeIds && body.resetNodeIds.length > 0
    ? body.resetNodeIds
    : deriveDefaultResetNodeIds(graph);

  const scheduled = activateGraphSchedule(graph, {
    intervalMs: body.intervalMs,
    cronExpr: body.cronExpr,
    cadence: body.cadence,
    name: body.name,
    description: body.description,
    resetNodeIds,
    maxRuns: body.maxRuns,
    maxConsecutiveFailures: body.maxConsecutiveFailures,
    activeUntil: body.activeUntil,
    rootMessageId: body.rootMessageId,
    nowIso: new Date().toISOString(),
  });

  if (scheduled === graph) {
    return jsonWithSchema(GraphEnvelopeResponseSchema, { graph });
  }

  const ifMatch = body.ifMatchGraphVersion ?? graph.graphVersion;
  const persisted = persistGraphSchedule(scheduled, ifMatch);
  return jsonWithSchema(GraphEnvelopeResponseSchema, { graph: persisted ?? scheduled });
}

const PatchScheduleSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, PatchScheduleSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "update",
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  if (!graph.schedule) {
    return jsonWithSchema(ErrorResponseSchema, { error: "No schedule on this graph" }, { status: 400 });
  }

  const { action } = parsedBody.data;
  const newState = action === "pause" ? "paused" : "active";

  if (graph.schedule.state === newState) {
    return jsonWithSchema(GraphEnvelopeResponseSchema, { graph });
  }

  const updated: ExecutionGraph = {
    ...graph,
    schedule: {
      ...graph.schedule,
      state: newState as "active" | "paused",
      // Clear failure count on resume
      ...(action === "resume" ? { consecutiveFailures: 0 } : {}),
    },
  };

  const persisted = persistGraphSchedule(updated, graph.graphVersion);
  return jsonWithSchema(GraphEnvelopeResponseSchema, { graph: persisted ?? updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "update",
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  const deactivated = deactivateGraphSchedule(graph);
  if (deactivated === graph) {
    return jsonWithSchema(GraphEnvelopeResponseSchema, { graph });
  }

  const persisted = persistGraphSchedule(deactivated, graph.graphVersion);
  return jsonWithSchema(GraphEnvelopeResponseSchema, { graph: persisted ?? deactivated });
}

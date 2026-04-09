import { NextRequest } from "next/server";
import { z } from "zod";

import { buildBudgetConsumedEvent, buildReplanEvent } from "@/src/graph/audit";
import { ErrorResponseSchema, ReplanRequestSchema } from "@/src/graph/api-schemas";
import {
  graphConflictResponse,
  jsonWithSchema,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import { recordReplan } from "@/src/graph/observability";
import {
  appendEvent,
  getGraph,
  GraphVersionConflictError,
  updateGraphStructure,
} from "@/src/graph/store";
import type { Edge, GraphNode, NodeStatus } from "@/src/graph/types";
import { validateGraph } from "@/src/graph/validate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ReplanResponseSchema = z.object({
  graphId: z.string().min(1),
  graphVersion: z.number(),
  updatedAt: z.string().min(1),
  replanBudgetRemaining: z.number(),
});

function buildNodeFromPartial(nodeId: string, partial: Record<string, unknown>): GraphNode {
  const type = partial.type === "gate" || partial.type === "fork" || partial.type === "join" || partial.type === "conditional" || partial.type === "function"
    ? partial.type
    : "work";
  const deps = Array.isArray(partial.deps)
    ? partial.deps.filter((dep): dep is string => typeof dep === "string")
    : [];
  const status = typeof partial.status === "string" ? partial.status : "pending";

  if (type === "work") {
    return {
      type: "work",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "blocked" | "skipped">,
      deps,
      title: typeof partial.title === "string" && partial.title.trim().length > 0 ? partial.title : nodeId,
      attempts: typeof partial.attempts === "number" ? partial.attempts : 0,
      maxAttempts: typeof partial.maxAttempts === "number" ? partial.maxAttempts : 1,
      retryPolicy: {
        backoffMs:
          typeof (partial.retryPolicy as { backoffMs?: unknown } | undefined)?.backoffMs === "number"
            ? (partial.retryPolicy as { backoffMs: number }).backoffMs
            : 1_000,
        onExhaust:
          (partial.retryPolicy as { onExhaust?: "escalate" | "fail" | "skip" } | undefined)?.onExhaust ??
          "escalate",
      },
    };
  }

  if (type === "gate") {
    return {
      type: "gate",
      status: status as Extract<NodeStatus, "pending" | "running" | "awaiting_human" | "passed" | "failed" | "skipped">,
      deps,
      gateType:
        partial.gateType === "progress" ||
        partial.gateType === "quality_gate" ||
        partial.gateType === "design_gate" ||
        partial.gateType === "handoff_gate" ||
        partial.gateType === "approval_gate"
          ? partial.gateType
          : "progress",
      required: Boolean(partial.required),
      verificationStrategy: {
        type:
          (partial.verificationStrategy as { type?: "auto" | "human" | "hybrid" } | undefined)?.type ??
          "auto",
        checks:
          (partial.verificationStrategy as { checks?: string[] } | undefined)?.checks ?? [],
      },
    };
  }

  if (type === "fork") {
    return {
      type: "fork",
      status: status as Extract<NodeStatus, "pending" | "done" | "skipped">,
      deps,
    };
  }

  if (type === "join") {
    return {
      type: "join",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped">,
      deps,
      joinStrategy:
        partial.joinStrategy === "all" || partial.joinStrategy === "any" || partial.joinStrategy === "n_of_m"
          ? partial.joinStrategy
          : "all",
    };
  }

  if (type === "function") {
    return {
      type: "function",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped">,
      deps,
      kind: partial.kind === "mcp" ? "mcp" : "bash",
      title: typeof partial.title === "string" && partial.title.trim().length > 0 ? partial.title : nodeId,
      description: typeof partial.description === "string" && partial.description.trim().length > 0
        ? partial.description
        : undefined,
      command: typeof partial.command === "string" && partial.command.trim().length > 0
        ? partial.command
        : nodeId,
      ...(
        partial.args && typeof partial.args === "object" && !Array.isArray(partial.args)
          ? { args: partial.args as Record<string, unknown> }
          : {}
      ),
      ...(typeof partial.timeoutMs === "number" ? { timeoutMs: partial.timeoutMs } : {}),
      ...(
        partial.output && typeof partial.output === "object" && !Array.isArray(partial.output)
          ? { output: partial.output as Record<string, unknown> }
          : {}
      ),
    };
  }

  return {
    type: "conditional",
    status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped">,
    deps,
    condition: {
      expression:
        typeof (partial.condition as { expression?: unknown } | undefined)?.expression === "string"
          ? ((partial.condition as { expression: string }).expression || "true")
          : "true",
      inputFrom:
        typeof (partial.condition as { inputFrom?: unknown } | undefined)?.inputFrom === "string"
          ? ((partial.condition as { inputFrom: string }).inputFrom || deps[0] || nodeId)
          : deps[0] || nodeId,
    },
    thenBranch: Array.isArray(partial.thenBranch)
      ? partial.thenBranch.filter((branch): branch is string => typeof branch === "string")
      : [],
    elseBranch: Array.isArray(partial.elseBranch)
      ? partial.elseBranch.filter((branch): branch is string => typeof branch === "string")
      : [],
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, ReplanRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const input = parsedBody.data;

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "replan",
    requestedProjectId: input.projectId ?? input.project_id,
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }
  if (!graph.nodes[input.triggeredAtNodeId]) {
    return jsonWithSchema(
      ErrorResponseSchema,
      { error: "triggeredAtNodeId does not exist in graph" },
      { status: 400 },
    );
  }
  if (graph.policy.replanBudgetRemaining <= 0) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Replan budget exhausted" }, { status: 409 });
  }

  const changes = input.proposedChanges ?? {};
  const nextNodes: Record<string, GraphNode> = { ...graph.nodes };
  const addedNodes = Object.entries(changes.addNodes ?? {});
  for (const [nodeId, node] of addedNodes) {
    nextNodes[nodeId] = buildNodeFromPartial(nodeId, node as Record<string, unknown>);
  }

  const removedNodes = (changes.removeNodes ?? []).filter(
    (nodeId): nodeId is string => typeof nodeId === "string",
  );
  for (const nodeId of removedNodes) {
    delete nextNodes[nodeId];
  }

  let nextEdges: Edge[];
  if (Array.isArray(changes.rewireEdges)) {
    nextEdges = changes.rewireEdges;
  } else {
    nextEdges = graph.edges.filter(
      (edge) => !removedNodes.includes(edge.from) && !removedNodes.includes(edge.to),
    );
  }

  for (const node of Object.values(nextNodes)) {
    node.deps = node.deps.filter((dep) => dep in nextNodes);
  }

  const estimateDeltas = changes.estimateDeltas ?? {};
  for (const [nodeId, delta] of Object.entries(estimateDeltas)) {
    const node = nextNodes[nodeId];
    if (!node || node.type !== "work") {
      continue;
    }
    const nextEstimate = (node.estimateMinutes ?? 0) + delta;
    node.estimateMinutes = nextEstimate < 0 ? 0 : nextEstimate;
  }

  const validated = validateGraph({
    ...graph,
    nodes: nextNodes,
    edges: nextEdges,
  });
  if (!validated.valid) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid replan graph" }, { status: 400 });
  }

  try {
    const nextPolicy = {
      ...graph.policy,
      replanBudgetRemaining: Math.max(0, graph.policy.replanBudgetRemaining - 1),
    };

    const updated = await updateGraphStructure(
      graph.id,
      {
        mode: graph.mode,
        nodes: nextNodes,
        edges: nextEdges,
        policy: nextPolicy,
        doneCriteria: graph.doneCriteria,
      },
      input.ifMatchGraphVersion,
    );

    await appendEvent(
      graph.id,
      buildReplanEvent({
        actor: authz.actor,
        fromVersion: graph.graphVersion,
        toVersion: updated.graphVersion,
        reason: input.reason,
        triggeredAtNodeId: input.triggeredAtNodeId,
        changes: {
          addedNodes: addedNodes.map(([nodeId]) => nodeId),
          removedNodes,
          rewiredDeps: (changes.rewireEdges ?? []).map((edge) => `${edge.from}->${edge.to}`),
          estimateDeltas,
        },
        projectId: authz.projectId,
      }),
    );

    await appendEvent(
      graph.id,
      buildBudgetConsumedEvent({
        actor: authz.actor,
        budgetType: "replan",
        remaining: nextPolicy.replanBudgetRemaining,
        triggerNodeId: input.triggeredAtNodeId,
        projectId: authz.projectId,
      }),
    );

    recordReplan();
    return jsonWithSchema(ReplanResponseSchema, {
      graphId: graph.id,
      graphVersion: updated.graphVersion,
      updatedAt: updated.updatedAt,
      replanBudgetRemaining: nextPolicy.replanBudgetRemaining,
    });
  } catch (error) {
    if (error instanceof GraphVersionConflictError) {
      return graphConflictResponse(error);
    }

    console.error("Error handling graph replan:", error);
    return jsonWithSchema(ErrorResponseSchema, { error: "Failed to replan graph" }, { status: 500 });
  }
}

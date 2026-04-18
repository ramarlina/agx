import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildBudgetConsumedEvent,
  buildGateVerificationEvent,
  buildGraphCreatedEvent,
  buildNodeStatusEvent,
} from "@/src/graph/audit";
import {
  CreateGraphRequestSchema,
  type CreateGraphRequest,
  DaemonGraphPatchRequestSchema,
  ErrorResponseSchema,
  GraphEnvelopeResponseSchema,
  GraphUpdateResponseSchema,
  UpdateNodeRuntimeRequestSchema,
} from "@/src/graph/api-schemas";
import {
  graphConflictResponse,
  jsonWithSchema,
  normalizeOptionalString,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { DEFAULT_EXECUTION_POLICY } from "@/src/graph/constants";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import {
  recordGateVerificationResult,
  recordGraphCreate,
  recordMigrationFailure,
} from "@/src/graph/observability";
import {
  appendEvent,
  createGraph,
  getGraph,
  GraphNodeNotFoundError,
  GraphTaskAlreadyBoundError,
  GraphVersionConflictError,
  updateGraphStructure,
  updateNodeRuntime,
} from "@/src/graph/store";
import { assertValidNodeStatusTransition } from "@/src/graph/state-machine";
import { logParityDiff } from "@/src/graph/parity";
import type {
  Edge,
  ExecutionGraph,
  GateType,
  GraphNode,
  NodeStatus,
  NodeStatusEvent,
  NodeType,
} from "@/src/graph/types";
import { createRootOnlyGraph } from "@/src/graph/migrate";
import { validateGraph } from "@/src/graph/validate";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const GraphExistsConflictResponseSchema = z.object({
  error: z.string().min(1),
  currentGraphVersion: z.number(),
});

const GraphNodeMissingResponseSchema = z.object({
  error: z.string().min(1),
  nodeIds: z.array(z.string()),
});

function resolveRequestedProjectId(body: {
  projectId?: string;
  project_id?: string;
}): string | null {
  return normalizeOptionalString(body.projectId) ?? normalizeOptionalString(body.project_id);
}

function deriveEdgesFromDeps(nodes: Record<string, GraphNode>): Edge[] {
  const edges: Edge[] = [];
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const dep of node.deps) {
      edges.push({
        from: dep,
        to: nodeId,
        type: "hard",
        condition: "always",
      });
    }
  }
  return edges;
}

function buildNodeFromPartial(nodeId: string, partial: NonNullable<CreateGraphRequest["nodes"]>[string]): GraphNode {
  const nodeType = partial.type ?? "work";
  const status = partial.status ?? "pending";
  const deps = Array.isArray(partial.deps)
    ? partial.deps.filter((dep): dep is string => typeof dep === "string")
    : [];

  if (nodeType === "work") {
    return {
      type: "work",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "blocked" | "skipped">,
      deps,
      ...(partial.workType ? { workType: partial.workType } : {}),
      title: normalizeOptionalString(partial.title) ?? nodeId,
      description: normalizeOptionalString(partial.description) ?? undefined,
      ...(Array.isArray((partial as { where?: string[] }).where) ? { where: (partial as { where?: string[] }).where } : {}),
      ...(Array.isArray((partial as { whatChanges?: string[] }).whatChanges) ? { whatChanges: (partial as { whatChanges?: string[] }).whatChanges } : {}),
      ...(Array.isArray((partial as { acceptanceCriteria?: string[] }).acceptanceCriteria) ? { acceptanceCriteria: (partial as { acceptanceCriteria?: string[] }).acceptanceCriteria } : {}),
      ...(Array.isArray((partial as { todos?: string[] }).todos) ? { todos: (partial as { todos?: string[] }).todos } : {}),
      ...(Array.isArray((partial as { verification?: string[] }).verification) ? { verification: (partial as { verification?: string[] }).verification } : {}),
      ...(normalizeOptionalString((partial as { generatedByPlanNodeId?: string }).generatedByPlanNodeId)
        ? { generatedByPlanNodeId: normalizeOptionalString((partial as { generatedByPlanNodeId?: string }).generatedByPlanNodeId)! }
        : {}),
      ...(normalizeOptionalString((partial as { planNodeKey?: string }).planNodeKey)
        ? { planNodeKey: normalizeOptionalString((partial as { planNodeKey?: string }).planNodeKey)! }
        : {}),
      attempts: Number(partial.attempts ?? 0),
      maxAttempts: Number(partial.maxAttempts ?? 1),
      retryPolicy: {
        backoffMs: Number(partial.retryPolicy?.backoffMs ?? 1_000),
        onExhaust: partial.retryPolicy?.onExhaust ?? "escalate",
      },
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.output ? { output: partial.output } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  if (nodeType === "gate") {
    return {
      type: "gate",
      status: status as Extract<
        NodeStatus,
        "pending" | "running" | "awaiting_human" | "passed" | "failed" | "skipped" | "paused" | "stopped"
      >,
      deps,
      gateType: (partial.gateType as GateType | undefined) ?? "progress",
      required: Boolean(partial.required),
      verificationStrategy: {
        type: partial.verificationStrategy?.type ?? "auto",
        checks: partial.verificationStrategy?.checks ?? [],
        timeout: partial.verificationStrategy?.timeout,
      },
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  if (nodeType === "function") {
    return {
      type: "function",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped">,
      deps,
      kind: partial.kind === "mcp" ? "mcp" : "bash",
      title: normalizeOptionalString(partial.title) ?? nodeId,
      description: normalizeOptionalString(partial.description) ?? undefined,
      command: normalizeOptionalString(partial.command) ?? nodeId,
      ...(
        partial.args
        && typeof partial.args === "object"
        && !Array.isArray(partial.args)
          ? { args: partial.args as Record<string, unknown> }
          : {}
      ),
      ...(typeof partial.timeoutMs === "number" ? { timeoutMs: partial.timeoutMs } : {}),
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.output ? { output: partial.output } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  if (nodeType === "root") {
    return {
      type: "root",
      status: status as NodeStatus,
      deps,
      title: normalizeOptionalString(partial.title) ?? nodeId,
      objective: normalizeOptionalString(partial.objective) ?? "",
      graphCreated: partial.graphCreated ?? false,
      criteria: partial.criteria ?? [],
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  if (nodeType === "fork") {
    return {
      type: "fork",
      status: status as Extract<NodeStatus, "pending" | "done" | "skipped">,
      deps,
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  if (nodeType === "join") {
    return {
      type: "join",
      status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped" | "paused" | "stopped">,
      deps,
      joinStrategy: partial.joinStrategy ?? "all",
      requiredCount: partial.requiredCount,
      ...(partial.metrics ? { metrics: partial.metrics } : {}),
      ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
      ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
      ...(partial.stage ? { stage: partial.stage } : {}),
      ...(partial.lane ? { lane: partial.lane } : {}),
    };
  }

  return {
    type: "conditional",
    status: status as Extract<NodeStatus, "pending" | "running" | "done" | "failed" | "skipped" | "paused" | "stopped">,
    deps,
    condition: {
      expression: normalizeOptionalString(partial.condition?.expression) ?? "true",
      inputFrom: normalizeOptionalString(partial.condition?.inputFrom) ?? deps[0] ?? nodeId,
    },
    thenBranch: partial.thenBranch?.filter((branchNodeId): branchNodeId is string => typeof branchNodeId === "string") ?? [],
    elseBranch: partial.elseBranch?.filter((branchNodeId): branchNodeId is string => typeof branchNodeId === "string") ?? [],
    ...(partial.metrics ? { metrics: partial.metrics } : {}),
    ...(partial.startedAt ? { startedAt: partial.startedAt } : {}),
    ...(partial.completedAt ? { completedAt: partial.completedAt } : {}),
    ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
    ...(partial.actualMinutes !== undefined ? { actualMinutes: partial.actualMinutes } : {}),
    ...(partial.stage ? { stage: partial.stage } : {}),
    ...(partial.lane ? { lane: partial.lane } : {}),
  };
}

function buildGraphFromCreateRequest(taskId: string, input: CreateGraphRequest): ExecutionGraph {
  if (input.graph) {
    const graph = input.graph as ExecutionGraph;
    return {
      ...graph,
      id: normalizeOptionalString(graph.id) ?? randomUUID(),
      taskId,
      createdAt: graph.createdAt ?? new Date().toISOString(),
      updatedAt: graph.updatedAt ?? new Date().toISOString(),
      versionHistory: graph.versionHistory ?? [],
      runtimeEvents: graph.runtimeEvents ?? [],
    };
  }

  const now = new Date().toISOString();
  const nodes: Record<string, GraphNode> = {};
  for (const [nodeId, partialNode] of Object.entries(input.nodes ?? {})) {
    nodes[nodeId] = buildNodeFromPartial(nodeId, partialNode);
  }

  const edges = Array.isArray(input.edges) ? input.edges : deriveEdgesFromDeps(nodes);
  const completionSinkNodeIds = Object.keys(nodes).filter(
    (nodeId) => !edges.some((edge) => edge.from === nodeId && edge.type === "hard"),
  );

  return {
    id: randomUUID(),
    taskId,
    graphVersion: 1,
    mode: input.mode ?? "SIMPLE",
    nodes,
    edges,
    policy: {
      ...DEFAULT_EXECUTION_POLICY,
      ...(input.policy ?? {}),
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds,
      ...(input.doneCriteria ?? {}),
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
    versionHistory: [],
    runtimeEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

function mapNodeTypes(graph: ExecutionGraph): Map<string, NodeType> {
  const map = new Map<string, NodeType>();
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    map.set(nodeId, node.type);
  }
  return map;
}

function isAutoPassProgressGate(node: GraphNode): boolean {
  if (node.type !== "gate") {
    return false;
  }
  const checks = node.verificationStrategy.checks ?? [];
  return node.gateType === "progress" && checks.length === 0 && node.verificationStrategy.type === "auto";
}

async function appendRejectedTransitionEvent(input: {
  graphId: string;
  actor: { actorId: string; actorType: "user" | "service" };
  projectId: string | null;
  nodeId: string;
  fromStatus: NodeStatus;
  toStatus: NodeStatus;
  reason: string;
}): Promise<void> {
  try {
    await appendEvent(
      input.graphId,
      buildNodeStatusEvent({
        actor: input.actor,
        nodeId: input.nodeId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        projectId: input.projectId,
      }),
    );
  } catch (error) {
    logger.error("Failed to append rejected transition event", logger.formatError(error));
  }
}

async function appendNodeRuntimeAuditEvents(
  graphId: string,
  transitions: NodeStatusEvent[],
): Promise<void> {
  for (const transition of transitions) {
    await appendEvent(graphId, transition);
  }
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

  return jsonWithSchema(GraphEnvelopeResponseSchema, { graph });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, CreateGraphRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const createInput = parsedBody.data;
  if (!createInput.migration && !createInput.graph && (!createInput.mode || !createInput.nodes)) {
    return jsonWithSchema(
      ErrorResponseSchema,
      { error: "mode and nodes are required when graph is not provided" },
      { status: 400 },
    );
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "create",
    requestedProjectId: resolveRequestedProjectId(createInput),
  });
  if (!authz.ok) {
    return authz.response;
  }

  try {
    const existing = await getGraph(taskId);
    if (existing) {
      if (
        createInput.ifMatchGraphVersion !== undefined &&
        createInput.ifMatchGraphVersion !== existing.graphVersion
      ) {
        return jsonWithSchema(
          GraphExistsConflictResponseSchema,
          {
            error: `Execution graph version conflict: expected ${createInput.ifMatchGraphVersion}, found ${existing.graphVersion}.`,
            currentGraphVersion: existing.graphVersion,
          },
          { status: 409 },
        );
      }

      return jsonWithSchema(
        GraphExistsConflictResponseSchema,
        { error: "Graph already exists for task", currentGraphVersion: existing.graphVersion },
        { status: 409 },
      );
    }

    const graph = createInput.migration && !createInput.graph && !createInput.nodes
      ? createRootOnlyGraph({
          id: taskId,
          title: authz.task.title || undefined,
          description: authz.task.description || undefined,
          content: authz.task.content || undefined,
        })
      : buildGraphFromCreateRequest(taskId, createInput);
    const validation = validateGraph(graph);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Invalid execution graph",
          validationErrors: validation.errors,
        },
        { status: 400 },
      );
    }

    const persisted = await createGraph(graph);
    await appendEvent(
      persisted.id,
      buildGraphCreatedEvent({
        actor: authz.actor,
        mode: persisted.mode,
        nodeCount: Object.keys(persisted.nodes).length,
        edgeCount: persisted.edges.length,
        projectId: authz.projectId,
      }),
    );
    recordGraphCreate();

    return jsonWithSchema(GraphEnvelopeResponseSchema, { graph: persisted }, { status: 201 });
  } catch (error) {
    if (createInput.migration === true || new URL(request.url).searchParams.get("source") === "migration") {
      recordMigrationFailure();
    }

    if (error instanceof GraphTaskAlreadyBoundError) {
      return NextResponse.json(
        {
          error: "Task is already linked to a different graph",
          taskId: error.taskId,
          existingGraphId: error.existingGraphId,
        },
        { status: 409 },
      );
    }

    logger.error("Error creating execution graph", logger.formatError(error));
    return jsonWithSchema(ErrorResponseSchema, { error: "Failed to create graph" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid task id" }, { status: 400 });
  }

  // Clone request body so we can inspect it for format detection
  const rawBody = await request.json().catch(() => ({}));

  // Daemon sends { graph, ifMatchGraphVersion } or { nodes, edges, ... } (full replacement)
  const isDaemonPayload = rawBody.graph || (rawBody.nodes && !rawBody.nodeUpdates);
  if (isDaemonPayload) {
    return handleDaemonGraphPatch(request, taskId, rawBody);
  }

  const parsedBody = UpdateNodeRuntimeRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid request payload",
        issues: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const updateInput = parsedBody.data;

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "update",
    requestedProjectId: resolveRequestedProjectId(updateInput),
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  const transitions: NodeStatusEvent[] = [];
  const nodeTypes = mapNodeTypes(graph);
  for (const [nodeId, patch] of Object.entries(updateInput.nodeUpdates)) {
    const currentNode = graph.nodes[nodeId];
    if (!currentNode) {
      return jsonWithSchema(ErrorResponseSchema, { error: `Unknown node: ${nodeId}` }, { status: 404 });
    }

    if (!patch.status || patch.status === currentNode.status) {
      continue;
    }

    try {
      assertValidNodeStatusTransition(currentNode.type, currentNode.status, patch.status);
    } catch {
      await appendRejectedTransitionEvent({
        graphId: graph.id,
        actor: authz.actor,
        projectId: authz.projectId,
        nodeId,
        fromStatus: currentNode.status,
        toStatus: patch.status,
        reason: "Rejected invalid transition",
      });

      return jsonWithSchema(
        ErrorResponseSchema,
        {
          error: `Invalid node transition for ${nodeId}: ${currentNode.status} -> ${patch.status}`,
        },
        { status: 400 },
      );
    }

    if (currentNode.type === "gate" && currentNode.status === "pending" && patch.status === "passed") {
      if (!isAutoPassProgressGate(currentNode)) {
        await appendRejectedTransitionEvent({
          graphId: graph.id,
          actor: authz.actor,
          projectId: authz.projectId,
          nodeId,
          fromStatus: currentNode.status,
          toStatus: patch.status,
          reason: "Rejected required gate bypass",
        });

        return jsonWithSchema(
          ErrorResponseSchema,
          {
            error: `Required gate transition blocked for node ${nodeId}`,
          },
          { status: 400 },
        );
      }
    }

    transitions.push(
      buildNodeStatusEvent({
        actor: authz.actor,
        nodeId,
        fromStatus: currentNode.status,
        toStatus: patch.status,
        reason: "PATCH /graph",
        projectId: authz.projectId,
      }),
    );
  }

  try {
    const updated = await updateNodeRuntime(
      graph.id,
      updateInput.nodeUpdates as Record<string, import("@/src/graph/store").NodeRuntimeUpdate>,
      updateInput.ifMatchGraphVersion,
    );

    await appendNodeRuntimeAuditEvents(graph.id, transitions);

    for (const transition of transitions) {
      const nodeType = nodeTypes.get(transition.nodeId);
      if (nodeType === "gate" && (transition.toStatus === "passed" || transition.toStatus === "failed")) {
        const passed = transition.toStatus === "passed";
        recordGateVerificationResult(passed);
        await appendEvent(
          graph.id,
          buildGateVerificationEvent({
            actor: authz.actor,
            nodeId: transition.nodeId,
            result: {
              passed,
              checks: [],
              verifiedAt: transition.timestamp,
              verifiedBy: authz.actor.actorType === "user" ? "human" : "agent",
            },
            timestamp: transition.timestamp,
            projectId: authz.projectId,
          }),
        );
      }
    }

    for (const budgetUpdate of updateInput.budgetUpdates ?? []) {
      await appendEvent(
        graph.id,
        buildBudgetConsumedEvent({
          actor: authz.actor,
          budgetType: budgetUpdate.budgetType,
          remaining: budgetUpdate.remaining,
          triggerNodeId: budgetUpdate.triggerNodeId,
          projectId: authz.projectId,
        }),
      );
    }

    const parityGraph = await getGraph(taskId);
    if (parityGraph) {
      logParityDiff({
        source: "graph_patch_runtime",
        task: authz.task,
        graph: parityGraph,
      });
    }

    return jsonWithSchema(GraphUpdateResponseSchema, { update: updated });
  } catch (error) {
    if (error instanceof GraphVersionConflictError) {
      return graphConflictResponse(error);
    }
    if (error instanceof GraphNodeNotFoundError) {
      return jsonWithSchema(
        GraphNodeMissingResponseSchema,
        { error: error.message, nodeIds: error.nodeIds },
        { status: 404 },
      );
    }

    logger.error("Error updating graph runtime", logger.formatError(error));
    return jsonWithSchema(ErrorResponseSchema, { error: "Failed to patch graph runtime" }, { status: 500 });
  }
}

// Handle daemon full-graph replacement payloads
async function handleDaemonGraphPatch(
  request: NextRequest,
  taskId: string,
  rawBody: Record<string, unknown>,
) {
  const parsed = DaemonGraphPatchRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request payload",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "update",
    requestedProjectId: resolveRequestedProjectId(body),
  });
  if (!authz.ok) {
    return authz.response;
  }

  const existingGraph = await getGraph(taskId);
  if (!existingGraph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  // Extract the graph data from either { graph: {...} } or top-level fields
  const sourceGraph = (body.graph ?? body) as Record<string, unknown>;
  const nodes = (sourceGraph.nodes ?? existingGraph.nodes) as Record<string, GraphNode>;
  const edges = (sourceGraph.edges ?? existingGraph.edges) as Edge[];
  const policy = (sourceGraph.policy ?? existingGraph.policy) as ExecutionGraph["policy"];
  const doneCriteria = (sourceGraph.doneCriteria ?? existingGraph.doneCriteria) as ExecutionGraph["doneCriteria"];
  const schedule = (sourceGraph.schedule ?? existingGraph.schedule) as ExecutionGraph["schedule"];
  const mode = (sourceGraph.mode ?? existingGraph.mode) as ExecutionGraph["mode"];

  const ifMatchVersion = (body.ifMatchGraphVersion ??
    (body.graph as any)?.graphVersion ??
    existingGraph.graphVersion) as number;

  try {
    await updateGraphStructure(
      existingGraph.id,
      { mode, nodes, edges, policy, doneCriteria, schedule },
      ifMatchVersion,
    );

    // Return the full graph so the daemon can continue with it
    const updatedGraph = await getGraph(taskId);
    if (!updatedGraph) {
      return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found after update" }, { status: 500 });
    }
    return jsonWithSchema(GraphEnvelopeResponseSchema, { graph: updatedGraph });
  } catch (error) {
    if (error instanceof GraphVersionConflictError) {
      return graphConflictResponse(error);
    }

    logger.error("Error updating graph (daemon patch)", logger.formatError(error));
    return jsonWithSchema(ErrorResponseSchema, { error: "Failed to patch graph" }, { status: 500 });
  }
}

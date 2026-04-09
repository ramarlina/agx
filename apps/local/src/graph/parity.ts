import type { Task, TaskStage, TaskStatus } from "@/lib/db-adapter.interface";
import { isParityLoggingEnabled } from "@/src/graph/feature-flags";
import type { ExecutionGraph, GraphNode, NodeStatus } from "@/src/graph/types";

interface LegacyProjection {
  status: TaskStatus | string | null | undefined;
  stage: TaskStage | string | null | undefined;
  progressPercent?: number | null;
}

export interface V2Projection {
  status: TaskStatus;
  stage: TaskStage;
  progressPercent: number;
}

export interface ParityDiff {
  taskId: string;
  source: string;
  diffs: Array<{
    field: "status" | "stage" | "progressPercent";
    legacy: unknown;
    v2: unknown;
  }>;
}

const TERMINAL_NODE_STATUSES = new Set<NodeStatus>(["done", "passed", "failed", "skipped"]);
const ACTIVE_NODE_STATUSES = new Set<NodeStatus>(["running", "awaiting_human", "blocked"]);
const DONE_SINK_NODE_STATUSES = new Set<NodeStatus>(["done", "passed", "skipped"]);

function normalizeStage(input: string | null | undefined, fallback: TaskStage): TaskStage {
  const value = String(input || "").trim().toUpperCase();
  if (value === "INTAKE" || value === "PROGRESS" || value === "DONE") {
    return value;
  }
  return fallback;
}

function normalizeTaskStatus(input: string | null | undefined): TaskStatus {
  const value = String(input || "").trim().toLowerCase();
  if (
    value === "queued" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return "queued";
}

function areRequiredGatesPassed(nodes: GraphNode[]): boolean {
  const requiredGates = nodes.filter(
    (node): node is Extract<GraphNode, { type: "gate" }> =>
      node.type === "gate" && node.required,
  );
  return requiredGates.every((gate) => gate.status === "passed" || gate.status === "skipped");
}

function areCompletionSinksSatisfied(graph: ExecutionGraph): boolean {
  const sinkNodeIds = graph.doneCriteria?.completionSinkNodeIds ?? [];
  if (sinkNodeIds.length === 0) {
    return false;
  }

  return sinkNodeIds.every((nodeId) => {
    const node = graph.nodes[nodeId];
    return Boolean(node && DONE_SINK_NODE_STATUSES.has(node.status));
  });
}

function computeGraphStatus(graph: ExecutionGraph): TaskStatus {
  const nodes = Object.values(graph.nodes);
  if (nodes.length === 0) {
    return "queued";
  }

  const requiredGatesPassed = areRequiredGatesPassed(nodes);
  const completionSinksSatisfied = areCompletionSinksSatisfied(graph);
  if (completionSinksSatisfied && requiredGatesPassed) {
    return "completed";
  }

  const allTerminal = nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status));

  if (allTerminal && requiredGatesPassed) {
    return "completed";
  }

  if (nodes.some((node) => node.status === "failed")) {
    return "failed";
  }

  if (nodes.some((node) => node.status === "blocked")) {
    return "blocked";
  }

  if (nodes.some((node) => ACTIVE_NODE_STATUSES.has(node.status))) {
    return "in_progress";
  }

  const startedNodeCount = nodes.filter(
    (node) => node.status === "done" || node.status === "passed",
  ).length;
  if (startedNodeCount > 0) {
    return "in_progress";
  }

  return "queued";
}

function computeProgressPercent(graph: ExecutionGraph): number {
  const nodes = Object.values(graph.nodes);
  if (nodes.length === 0) {
    return 0;
  }

  const completedLike = nodes.filter((node) => TERMINAL_NODE_STATUSES.has(node.status)).length;
  return Math.max(0, Math.min(100, Math.round((completedLike / nodes.length) * 100)));
}

function computeStage(graph: ExecutionGraph, fallbackStage: TaskStage): TaskStage {
  const computedStatus = computeGraphStatus(graph);
  if (computedStatus === "completed") {
    return "DONE";
  }
  if (computedStatus === "in_progress" || computedStatus === "blocked" || computedStatus === "failed") {
    return "PROGRESS";
  }
  return fallbackStage;
}

export function projectLegacyCompatFromGraph(
  graph: ExecutionGraph,
  fallbackStage: TaskStage = "INTAKE",
): V2Projection {
  const status = computeGraphStatus(graph);
  const stage = computeStage(graph, fallbackStage);
  const progressPercent = status === "completed" ? 100 : computeProgressPercent(graph);
  return { status, stage, progressPercent };
}

export function computeParityDiff(input: {
  taskId: string;
  source: string;
  legacy: LegacyProjection;
  v2: V2Projection;
}): ParityDiff | null {
  const diffs: ParityDiff["diffs"] = [];
  const normalizedLegacyStatus = normalizeTaskStatus(input.legacy.status);
  const normalizedLegacyStage = normalizeStage(input.legacy.stage, "INTAKE");
  const normalizedLegacyProgress = Number.isFinite(Number(input.legacy.progressPercent))
    ? Number(input.legacy.progressPercent)
    : null;

  if (normalizedLegacyStatus !== input.v2.status) {
    diffs.push({
      field: "status",
      legacy: normalizedLegacyStatus,
      v2: input.v2.status,
    });
  }

  if (normalizedLegacyStage !== input.v2.stage) {
    diffs.push({
      field: "stage",
      legacy: normalizedLegacyStage,
      v2: input.v2.stage,
    });
  }

  if (normalizedLegacyProgress !== null && normalizedLegacyProgress !== input.v2.progressPercent) {
    diffs.push({
      field: "progressPercent",
      legacy: normalizedLegacyProgress,
      v2: input.v2.progressPercent,
    });
  }

  if (diffs.length === 0) {
    return null;
  }

  return {
    taskId: input.taskId,
    source: input.source,
    diffs,
  };
}

export function logParityDiff(input: {
  source: string;
  task: Pick<Task, "id" | "status" | "stage">;
  graph: ExecutionGraph;
  legacyProgressPercent?: number | null;
}): ParityDiff | null {
  const parity = computeParityDiff({
    taskId: input.task.id,
    source: input.source,
    legacy: {
      status: input.task.status,
      stage: input.task.stage,
      progressPercent: input.legacyProgressPercent ?? null,
    },
    v2: projectLegacyCompatFromGraph(
      input.graph,
      normalizeStage(input.task.stage || "INTAKE", "INTAKE"),
    ),
  });

  if (parity && isParityLoggingEnabled()) {
    console.warn("[graph-parity-diff]", JSON.stringify(parity));
  }

  return parity;
}

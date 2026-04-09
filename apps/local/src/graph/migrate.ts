import { createHash, randomUUID } from "crypto";

import { DEFAULT_EXECUTION_POLICY } from "@/src/graph/constants";
import { deriveTaskObjective } from "@/src/graph/objective";
import type {
  ExecutionGraph,
  GateNode,
  GraphNode,
  NodeStatus,
  RootNode,
  WorkNode,
} from "@/src/graph/types";

const V1_VERSION = 1;
const V2_VERSION = 2;

const DEFAULT_MIGRATION_POLICY: ExecutionGraph["policy"] = {
  ...DEFAULT_EXECUTION_POLICY,
  replanBudgetInitial: 3,
  replanBudgetRemaining: 3,
  verifyBudgetInitial: 5,
  verifyBudgetRemaining: 5,
  maxConcurrentAutoChecks: 1,
  maxConcurrent: 1,
  priorityMode: "fifo",
};

export type LegacyTaskStatus =
  | "queued"
  | "pending"
  | "in_progress"
  | "running"
  | "blocked"
  | "completed"
  | "done"
  | "failed";

export interface V1Checkpoint {
  id: string;
  description: string;
  completed?: boolean;
  createdAt?: string;
  completedAt?: string;
}

export interface V1Task {
  id: string;
  title?: string;
  status?: LegacyTaskStatus | string | null;
  checkpoints?: V1Checkpoint[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface MigrateTaskToV2Options {
  graphId?: string;
  now?: string;
}

export interface MigrationAuditRow {
  task_id: string;
  old_version: number;
  new_version: number;
  result: "migrated" | "skipped" | "failed";
  error: string | null;
}

function sanitizeIdSegment(input: string): string {
  const normalized = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "checkpoint";
}

function stableCheckpointId(taskId: string, checkpointId: string, index: number): string {
  const digest = createHash("sha1")
    .update(`${taskId}:${checkpointId}:${index}`)
    .digest("hex")
    .slice(0, 10);
  return `${sanitizeIdSegment(checkpointId)}-${digest}`;
}

function normalizeLegacyStatus(status: V1Task["status"]): LegacyTaskStatus {
  const normalized = String(status || "queued").trim().toLowerCase();
  if (
    normalized === "queued" ||
    normalized === "pending" ||
    normalized === "in_progress" ||
    normalized === "running" ||
    normalized === "blocked" ||
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "failed"
  ) {
    return normalized;
  }
  return "queued";
}

function createWorkNode(input: {
  title: string;
  deps: string[];
  status: WorkNode["status"];
  startedAt?: string;
  completedAt?: string;
}): WorkNode {
  return {
    type: "work",
    status: input.status,
    deps: [...input.deps],
    title: input.title,
    attempts: input.status === "done" ? 1 : 0,
    maxAttempts: 2,
    retryPolicy: { backoffMs: 5_000, onExhaust: "escalate" },
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  };
}

function createProgressGate(input: {
  deps: string[];
  status: GateNode["status"];
  completedAt?: string;
}): GateNode {
  return {
    type: "gate",
    gateType: "progress",
    required: false,
    status: input.status,
    deps: [...input.deps],
    verificationStrategy: { type: "auto" },
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  };
}

function findFirstNodeIdByStatus(
  nodes: Record<string, GraphNode>,
  acceptedStatuses: ReadonlySet<NodeStatus>,
): string | null {
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (acceptedStatuses.has(node.status)) {
      return nodeId;
    }
  }
  return null;
}

function applyLegacyStatus(
  graph: ExecutionGraph,
  legacyStatus: LegacyTaskStatus,
  timestamps: { startedAt?: string | null; completedAt?: string | null },
): void {
  const nodeValues = Object.values(graph.nodes);
  const workNodes = nodeValues.filter((node): node is WorkNode => node.type === "work");
  const gateNodes = nodeValues.filter((node): node is GateNode => node.type === "gate");
  const handoff = graph.nodes["handoff-gate"];

  if (legacyStatus === "completed" || legacyStatus === "done") {
    for (const node of workNodes) {
      node.status = "done";
      if (timestamps.startedAt && !node.startedAt) {
        node.startedAt = timestamps.startedAt;
      }
      if (timestamps.completedAt) {
        node.completedAt = timestamps.completedAt;
      }
      node.attempts = Math.max(1, node.attempts);
    }
    for (const gate of gateNodes) {
      gate.status = "passed";
      if (timestamps.completedAt) {
        gate.completedAt = timestamps.completedAt;
      }
    }
    return;
  }

  if (legacyStatus === "failed") {
    const firstIncompleteWorkId = findFirstNodeIdByStatus(
      graph.nodes,
      new Set<NodeStatus>(["pending", "running", "blocked"]),
    );
    if (firstIncompleteWorkId && graph.nodes[firstIncompleteWorkId].type === "work") {
      const node = graph.nodes[firstIncompleteWorkId] as WorkNode;
      node.status = "failed";
      if (timestamps.completedAt) {
        node.completedAt = timestamps.completedAt;
      }
      node.attempts = Math.max(1, node.attempts);
      return;
    }

    if (handoff && handoff.type === "gate") {
      handoff.status = "failed";
      if (timestamps.completedAt) {
        handoff.completedAt = timestamps.completedAt;
      }
    }
    return;
  }

  if (legacyStatus === "blocked") {
    const blockedNodeId =
      findFirstNodeIdByStatus(graph.nodes, new Set<NodeStatus>(["pending", "running"])) ??
      findFirstNodeIdByStatus(graph.nodes, new Set<NodeStatus>(["done", "passed"]));
    if (blockedNodeId && graph.nodes[blockedNodeId].type === "work") {
      graph.nodes[blockedNodeId].status = "blocked";
    }
    return;
  }

  if (legacyStatus === "in_progress" || legacyStatus === "running") {
    const runningCandidateId = findFirstNodeIdByStatus(graph.nodes, new Set<NodeStatus>(["pending"]));
    if (runningCandidateId && graph.nodes[runningCandidateId].type === "work") {
      const node = graph.nodes[runningCandidateId] as WorkNode;
      node.status = "running";
      if (timestamps.startedAt && !node.startedAt) {
        node.startedAt = timestamps.startedAt;
      }
      node.attempts = Math.max(1, node.attempts);
    }
  }
}

function ensureHandoffGate(
  nodes: Record<string, GraphNode>,
  deps: string[],
  status: GateNode["status"] = "pending",
  completedAt?: string | null,
): void {
  nodes["handoff-gate"] = {
    type: "gate",
    gateType: "handoff_gate",
    required: true,
    status,
    deps: [...deps],
    verificationStrategy: { type: "human" },
    ...(completedAt ? { completedAt } : {}),
  };
}

export function createRootOnlyGraph(
  task: { id: string; title?: string; description?: string; content?: string },
  options?: { graphId?: string },
): ExecutionGraph {
  const now = new Date().toISOString();
  const rootNode: RootNode = {
    type: "root",
    status: "pending",
    deps: [],
    title: task.title || "Untitled task",
    objective: deriveTaskObjective(task),
    graphCreated: false,
    criteria: [],
  };

  const planNode: WorkNode = {
    type: "work",
    status: "pending",
    deps: ["root"],
    title: "Generate execution plan",
    description: "Analyze the task and generate a detailed execution graph with work nodes, gates, and dependencies.",
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: { backoffMs: 5_000, onExhaust: "escalate" },
  };

  const approvalGate: GateNode = {
    type: "gate",
    status: "pending",
    gateType: "approval_gate",
    required: true,
    deps: ["plan"],
    verificationStrategy: { type: "human" },
  };

  return {
    id: options?.graphId ?? randomUUID(),
    taskId: task.id,
    graphVersion: 1,
    mode: "SIMPLE",
    nodes: {
      root: rootNode,
      plan: planNode,
      "plan-approval": approvalGate,
    },
    edges: [
      { from: "root", to: "plan", type: "hard", condition: "always" },
      { from: "plan", to: "plan-approval", type: "hard", condition: "always" },
    ],
    policy: { ...DEFAULT_MIGRATION_POLICY },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["plan-approval"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function migrateTaskToV2(
  v1Task: V1Task,
  options: MigrateTaskToV2Options = {},
): ExecutionGraph {
  const checkpoints = Array.isArray(v1Task.checkpoints) ? v1Task.checkpoints : [];
  const nodes: Record<string, GraphNode> = {};
  const edges: ExecutionGraph["edges"] = [];
  const legacyStatus = normalizeLegacyStatus(v1Task.status);
  const migrationNow = options.now || v1Task.updatedAt || new Date().toISOString();

  let previousNodeId: string | null = null;

  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    const checkpointStableId = stableCheckpointId(v1Task.id, checkpoint.id, index);
    const workNodeId = `work-${checkpointStableId}`;
    const gateNodeId = `gate-${checkpointStableId}`;
    const checkpointDone = Boolean(checkpoint.completed);
    const checkpointCompletedAt = checkpoint.completedAt || checkpoint.createdAt;

    nodes[workNodeId] = createWorkNode({
      title: checkpoint.description || `Checkpoint ${index + 1}`,
      deps: previousNodeId ? [previousNodeId] : [],
      status: checkpointDone ? "done" : "pending",
      startedAt: checkpoint.createdAt || v1Task.startedAt || undefined,
      completedAt: checkpointDone ? checkpointCompletedAt : undefined,
    });

    nodes[gateNodeId] = createProgressGate({
      deps: [workNodeId],
      status: checkpointDone ? "passed" : "pending",
      completedAt: checkpointDone ? checkpointCompletedAt : undefined,
    });

    if (previousNodeId) {
      edges.push({ from: previousNodeId, to: workNodeId, type: "hard", condition: "always" });
    }
    edges.push({ from: workNodeId, to: gateNodeId, type: "hard", condition: "always" });
    previousNodeId = gateNodeId;
  }

  // Insert root node: all previously-root work nodes become children of root
  const rootStatus: NodeStatus =
    legacyStatus === "completed" || legacyStatus === "done" ? "done" : "pending";
  const firstWorkNodeIds = Object.entries(nodes)
    .filter(([, n]) => n.deps.length === 0)
    .map(([id]) => id);

  const rootNode: RootNode = {
    type: "root",
    status: rootStatus,
    deps: [],
    title: v1Task.title || "Migrated task",
    objective: v1Task.title || "",
    graphCreated: true,
    criteria: [],
  };
  nodes["root"] = rootNode;

  for (const nodeId of firstWorkNodeIds) {
    nodes[nodeId].deps = ["root"];
    edges.push({ from: "root", to: nodeId, type: "hard", condition: "always" });
  }

  // Only add handoff gate if there are actual checkpoints (work nodes)
  const hasWork = checkpoints.length > 0;
  if (hasWork) {
    const handoffDeps = previousNodeId ? [previousNodeId] : ["root"];
    ensureHandoffGate(
      nodes,
      handoffDeps,
      legacyStatus === "completed" || legacyStatus === "done" ? "passed" : "pending",
      legacyStatus === "completed" || legacyStatus === "done" ? v1Task.completedAt : null,
    );
    if (previousNodeId) {
      edges.push({ from: previousNodeId, to: "handoff-gate", type: "hard", condition: "always" });
    }
  }

  const graph: ExecutionGraph = {
    id: options.graphId ?? randomUUID(),
    taskId: v1Task.id,
    graphVersion: 1,
    mode: hasWork ? "PROJECT" : "SIMPLE",
    nodes,
    edges,
    policy: { ...DEFAULT_MIGRATION_POLICY },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: hasWork ? ["handoff-gate"] : ["root"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: v1Task.createdAt,
    updatedAt: v1Task.updatedAt || migrationNow,
  };

  applyLegacyStatus(graph, legacyStatus, {
    startedAt: v1Task.startedAt,
    completedAt: v1Task.completedAt,
  });

  return graph;
}

export function buildMigrationAuditRow(input: {
  taskId: string;
  result: MigrationAuditRow["result"];
  error?: string | null;
}): MigrationAuditRow {
  return {
    task_id: input.taskId,
    old_version: V1_VERSION,
    new_version: V2_VERSION,
    result: input.result,
    error: input.error ?? null,
  };
}

import type { Edge, ExecutionGraph, GraphNode, ReplanEvent } from "./types";
import { validateGraph } from "./validate";

export enum ReplanTrigger {
  GATE_FAILURE = "gate_failure",
  WORK_EXHAUSTED = "work_exhausted",
  AGENT_REQUEST = "agent_request",
  HUMAN_REQUEST = "human_request",
  SCOPE_CHANGE = "scope_change",
}

interface ReplanMutation {
  addNodes?: Record<string, GraphNode>;
  removeNodes?: string[];
  rewireDeps?: Record<string, string[]>;
  estimateUpdates?: Record<string, number | null>;
  /** Explicit edges to add (for controlling condition, e.g. on_failure) */
  addEdges?: Edge[];
}

export interface ReplanRequest extends ReplanMutation {
  trigger: ReplanTrigger;
  triggeredAtNodeId: string;
  reason: string;
  triggeredBy: ReplanEvent["triggeredBy"];
  now?: string;
}

export class ReplanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplanError";
  }
}

export class ReplanBudgetExceededError extends ReplanError {
  constructor() {
    super("Replan rejected: replan budget exhausted.");
    this.name = "ReplanBudgetExceededError";
  }
}

export class InvalidReplanPointError extends ReplanError {
  constructor(nodeId: string) {
    super(`Replan rejected: node "${nodeId}" is not a valid replan point.`);
    this.name = "InvalidReplanPointError";
  }
}

export class ReplanConstraintViolationError extends ReplanError {
  constructor(message: string) {
    super(message);
    this.name = "ReplanConstraintViolationError";
  }
}

export class ReplanValidationError extends ReplanError {
  readonly validationErrors: ReturnType<typeof validateGraph>["errors"];

  constructor(validationErrors: ReturnType<typeof validateGraph>["errors"]) {
    super("Replan rejected: resulting graph violates validation invariants.");
    this.name = "ReplanValidationError";
    this.validationErrors = validationErrors;
  }
}

const CHECKPOINT_GATE_TYPES = new Set([
  "progress",
  "quality_gate",
  "design_gate",
  "handoff_gate",
]);

function toTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function buildOutgoingHardEdges(edges: Edge[]): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type !== "hard") {
      continue;
    }
    const current = outgoing.get(edge.from);
    if (current) {
      current.push(edge.to);
    } else {
      outgoing.set(edge.from, [edge.to]);
    }
  }
  return outgoing;
}

function isCheckpointNode(node: GraphNode | undefined): boolean {
  return node?.type === "gate" && CHECKPOINT_GATE_TYPES.has(node.gateType);
}

function isGateReplanPoint(node: GraphNode): boolean {
  if (node.type !== "gate") {
    return false;
  }

  if (node.gateType === "progress") {
    return true;
  }

  if (
    node.gateType === "quality_gate" ||
    node.gateType === "design_gate" ||
    node.gateType === "handoff_gate"
  ) {
    return node.status === "failed";
  }

  return false;
}

function hasReachableCheckpoint(graph: ExecutionGraph, fromNodeId: string): boolean {
  const outgoing = buildOutgoingHardEdges(graph.edges);
  const queue = [...(outgoing.get(fromNodeId) ?? [])];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    if (isCheckpointNode(graph.nodes[nodeId])) {
      return true;
    }

    for (const nextNodeId of outgoing.get(nodeId) ?? []) {
      if (visited.has(nextNodeId)) {
        continue;
      }
      visited.add(nextNodeId);
      queue.push(nextNodeId);
    }
  }

  return false;
}

function hasUsedDirectWorkException(graph: ExecutionGraph, nodeId: string): boolean {
  return graph.versionHistory.some(
    (event) => event.eventType === "replan" && event.triggeredAtNodeId === nodeId,
  );
}

function isExhaustedWorkNode(node: GraphNode): boolean {
  return (
    node.type === "work" &&
    node.status === "failed" &&
    node.attempts >= node.maxAttempts
  );
}

function isValidReplanPoint(graph: ExecutionGraph, request: ReplanRequest): boolean {
  const node = graph.nodes[request.triggeredAtNodeId];
  if (!node) {
    return false;
  }

  if (isGateReplanPoint(node)) {
    return true;
  }

  if (node.type !== "work") {
    return false;
  }

  if (request.trigger !== ReplanTrigger.WORK_EXHAUSTED) {
    return false;
  }

  if (!isExhaustedWorkNode(node)) {
    return false;
  }

  if (hasReachableCheckpoint(graph, request.triggeredAtNodeId)) {
    return false;
  }

  if (hasUsedDirectWorkException(graph, request.triggeredAtNodeId)) {
    return false;
  }

  return true;
}

function ensureNodeExists(graph: ExecutionGraph, nodeId: string): void {
  if (!graph.nodes[nodeId]) {
    throw new ReplanConstraintViolationError(`Replan references unknown node "${nodeId}".`);
  }
}

function addNodes(graph: ExecutionGraph, nodesToAdd: Record<string, GraphNode>): string[] {
  const nodeEntries = Object.entries(nodesToAdd);
  if (nodeEntries.length === 0) {
    return [];
  }

  const incomingKeys = new Set<string>();

  for (const [nodeId] of nodeEntries) {
    if (graph.nodes[nodeId]) {
      throw new ReplanConstraintViolationError(`Cannot add duplicate node "${nodeId}".`);
    }
  }

  for (const [nodeId, node] of nodeEntries) {
    graph.nodes[nodeId] = node;
  }

  for (const [nodeId, node] of nodeEntries) {
    for (const depId of node.deps) {
      if (!graph.nodes[depId]) {
        throw new ReplanConstraintViolationError(
          `Added node "${nodeId}" depends on unknown node "${depId}".`,
        );
      }
      incomingKeys.add(`${depId}=>${nodeId}`);
    }
  }

  for (const key of incomingKeys) {
    const [from, to] = key.split("=>");
    graph.edges.push({
      from,
      to,
      type: "hard",
    });
  }

  return nodeEntries.map(([nodeId]) => nodeId);
}

function removeNodes(graph: ExecutionGraph, nodeIdsToRemove: string[]): string[] {
  const removed = new Set(nodeIdsToRemove);
  if (removed.size === 0) {
    return [];
  }

  for (const nodeId of removed) {
    const node = graph.nodes[nodeId];
    if (!node) {
      throw new ReplanConstraintViolationError(`Cannot remove unknown node "${nodeId}".`);
    }
    if (node.type === "gate" && node.required) {
      throw new ReplanConstraintViolationError(
        `Cannot remove required gate "${nodeId}" during replan.`,
      );
    }
  }

  for (const nodeId of removed) {
    delete graph.nodes[nodeId];
  }

  graph.edges = graph.edges.filter(
    (edge) => !removed.has(edge.from) && !removed.has(edge.to),
  );

  for (const node of Object.values(graph.nodes)) {
    node.deps = node.deps.filter((dep) => !removed.has(dep));
  }

  return [...removed];
}

function rewireDeps(graph: ExecutionGraph, rewires: Record<string, string[]>): string[] {
  const rewiredNodeIds: string[] = [];

  for (const [targetNodeId, nextDeps] of Object.entries(rewires)) {
    ensureNodeExists(graph, targetNodeId);
    const targetNode = graph.nodes[targetNodeId];
    if (!targetNode) {
      continue;
    }

    const uniqueDeps = [...new Set(nextDeps)];
    for (const depId of uniqueDeps) {
      ensureNodeExists(graph, depId);
    }

    const previousIncomingBySource = new Map<string, Edge>();
    for (const edge of graph.edges) {
      if (edge.to === targetNodeId && !previousIncomingBySource.has(edge.from)) {
        previousIncomingBySource.set(edge.from, edge);
      }
    }

    graph.edges = graph.edges.filter((edge) => edge.to !== targetNodeId);
    targetNode.deps = uniqueDeps;

    for (const depId of uniqueDeps) {
      const previousEdge = previousIncomingBySource.get(depId);
      graph.edges.push(
        previousEdge ?? {
          from: depId,
          to: targetNodeId,
          type: "hard",
        },
      );
    }

    rewiredNodeIds.push(targetNodeId);
  }

  return rewiredNodeIds;
}

function updateEstimates(
  graph: ExecutionGraph,
  estimateUpdates: Record<string, number | null>,
): Record<string, number> {
  const estimateDeltas: Record<string, number> = {};

  for (const [nodeId, estimateValue] of Object.entries(estimateUpdates)) {
    ensureNodeExists(graph, nodeId);
    const node = graph.nodes[nodeId];
    if (!node) {
      continue;
    }

    const previous = node.estimateMinutes ?? 0;
    if (estimateValue === null) {
      delete node.estimateMinutes;
      estimateDeltas[nodeId] = 0 - previous;
      continue;
    }

    node.estimateMinutes = estimateValue;
    estimateDeltas[nodeId] = estimateValue - previous;
  }

  return estimateDeltas;
}

function dedupeEdges(edges: Edge[]): Edge[] {
  const deduped: Edge[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}|${edge.condition ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edge);
  }

  return deduped;
}

function syncDepsFromEdges(graph: ExecutionGraph): void {
  const incomingByTarget = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const current = incomingByTarget.get(edge.to);
    if (current) {
      if (!current.includes(edge.from)) {
        current.push(edge.from);
      }
    } else {
      incomingByTarget.set(edge.to, [edge.from]);
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    node.deps = [...(incomingByTarget.get(nodeId) ?? [])];
  }
}

function ensureRequiredGatesPresent(
  original: ExecutionGraph,
  mutated: ExecutionGraph,
): void {
  for (const [nodeId, node] of Object.entries(original.nodes)) {
    if (node.type !== "gate" || !node.required) {
      continue;
    }

    if (!mutated.nodes[nodeId]) {
      throw new ReplanConstraintViolationError(
        `Required gate "${nodeId}" must remain present after replan.`,
      );
    }
  }
}

export function applyReplan(graph: ExecutionGraph, request: ReplanRequest): ExecutionGraph {
  if (graph.policy.replanBudgetRemaining <= 0) {
    throw new ReplanBudgetExceededError();
  }

  if (!isValidReplanPoint(graph, request)) {
    throw new InvalidReplanPointError(request.triggeredAtNodeId);
  }

  const nextGraph = structuredClone(graph);

  const removedNodes = removeNodes(nextGraph, request.removeNodes ?? []);
  const addedNodes = addNodes(nextGraph, request.addNodes ?? {});
  const rewiredDeps = rewireDeps(nextGraph, request.rewireDeps ?? {});
  const estimateDeltas = updateEstimates(nextGraph, request.estimateUpdates ?? {});

  // Add explicit edges (e.g. on_failure edges for review-triggered replans)
  if (request.addEdges) {
    for (const edge of request.addEdges) {
      nextGraph.edges.push(edge);
    }
  }

  nextGraph.edges = dedupeEdges(nextGraph.edges);
  syncDepsFromEdges(nextGraph);
  ensureRequiredGatesPresent(graph, nextGraph);

  const validation = validateGraph(nextGraph);
  if (!validation.valid) {
    throw new ReplanValidationError(validation.errors);
  }

  const now = toTimestamp(request.now);
  const fromVersion = nextGraph.graphVersion;
  const toVersion = fromVersion + 1;

  nextGraph.graphVersion = toVersion;
  nextGraph.policy.replanBudgetRemaining -= 1;
  nextGraph.updatedAt = now;
  nextGraph.versionHistory.push({
    eventType: "replan",
    fromVersion,
    toVersion,
    timestamp: now,
    reason: request.reason,
    triggeredBy: request.triggeredBy,
    triggeredAtNodeId: request.triggeredAtNodeId,
    changes: {
      addedNodes,
      removedNodes,
      rewiredDeps,
      estimateDeltas,
    },
  });

  return nextGraph;
}

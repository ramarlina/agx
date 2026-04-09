import type { ExecutionGraph, RollbackEvent } from "./types";

export interface RollbackRequest {
  checkpointNodeId: string;
  reason?: string;
  triggeredBy?: RollbackEvent["triggeredBy"];
  now?: string;
}

export class RollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackError";
  }
}

function toTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function findNodesAfterCheckpoint(
  graph: ExecutionGraph,
  checkpointNodeId: string,
): Set<string> {
  const queue: string[] = [];
  const visited = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.type === "hard" && edge.from === checkpointNodeId) {
      queue.push(edge.to);
      visited.add(edge.to);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    for (const edge of graph.edges) {
      if (edge.type !== "hard" || edge.from !== nodeId) {
        continue;
      }
      if (visited.has(edge.to)) {
        continue;
      }
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }

  return visited;
}

export function rollbackToCheckpoint(
  graph: ExecutionGraph,
  request: RollbackRequest,
): ExecutionGraph {
  const checkpointNode = graph.nodes[request.checkpointNodeId];
  if (!checkpointNode) {
    throw new RollbackError(`Rollback rejected: unknown checkpoint "${request.checkpointNodeId}".`);
  }

  if (checkpointNode.type !== "gate") {
    throw new RollbackError(
      `Rollback rejected: node "${request.checkpointNodeId}" is not a gate checkpoint.`,
    );
  }

  const nextGraph = structuredClone(graph);
  const affectedNodeIds = findNodesAfterCheckpoint(nextGraph, request.checkpointNodeId);

  for (const nodeId of affectedNodeIds) {
    const node = nextGraph.nodes[nodeId];
    if (!node) {
      continue;
    }

    node.status = "pending";

    if (node.type === "work") {
      node.attempts = 0;
      delete node.output;
    }
  }

  const now = toTimestamp(request.now);
  nextGraph.updatedAt = now;
  nextGraph.versionHistory.push({
    eventType: "rollback",
    toCheckpoint: request.checkpointNodeId,
    timestamp: now,
    reason: request.reason ?? "Manual rollback to checkpoint",
    triggeredBy: request.triggeredBy ?? "human",
  });

  return nextGraph;
}

/**
 * UI-layer graph helpers.
 *
 * Core logic (computeProgress, findCurrentBlocker, deriveTaskStatus)
 * is delegated to the canonical implementations in src/graph/derived.ts.
 */

import {
  computeProgress,
  findCurrentBlocker as findCurrentBlockerCore,
  deriveTaskStatus,
} from "@/src/graph/derived";
import type {
  ExecutionGraph,
  GateNode,
  GraphNode,
  NodeStatus,
  RootNode,
} from "@/src/graph/types";

export { computeProgress, deriveTaskStatus } from "@/src/graph/derived";
export type { DerivedTaskStatus } from "@/src/graph/derived";

export interface GraphBlocker {
  nodeId: string;
  label: string;
  status: NodeStatus;
  required: boolean;
}

export interface TaskGraphSummary {
  mode: ExecutionGraph["mode"];
  graphVersion: number;
  nodeCount: number;
  progress: number;
  currentBlocker: GraphBlocker | null;
  derivedStatus: ReturnType<typeof deriveTaskStatus>;
  hasRootNode: boolean;
  rootNodeId: string | null;
}

export function toNodeStatusClass(status: NodeStatus): string {
  return `node--${status}`;
}

function formatGateTypeLabel(gateType: GateNode["gateType"]): string {
  return gateType
    .replace(/_gate$/u, "")
    .replace(/_/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

export function formatNodeStatusLabel(status: NodeStatus): string {
  return status.replace(/_/gu, " ");
}

export function getNodeLabel(nodeId: string, node: GraphNode): string {
  if (node.type === "root") {
    return (node as RootNode).title?.trim() || "Task Objective";
  }

  if (node.type === "work") {
    return node.title?.trim() || nodeId;
  }

  if (node.type === "function") {
    return node.title?.trim() || nodeId;
  }

  if (node.type === "gate") {
    return formatGateTypeLabel(node.gateType);
  }

  if (node.type === "fork") {
    return "Fork";
  }

  if (node.type === "join") {
    return `Join (${node.joinStrategy})`;
  }

  return "Conditional";
}

/** UI-enriched version of findCurrentBlocker that includes a human label. */
export function findCurrentBlocker(graph: ExecutionGraph): GraphBlocker | null {
  const blockerId = findCurrentBlockerCore(graph);
  if (!blockerId) return null;

  const node = graph.nodes[blockerId];
  if (!node) return null;

  return {
    nodeId: blockerId,
    label: getNodeLabel(blockerId, node),
    status: node.status,
    required: node.type === "gate" ? node.required : false,
  };
}

/** Find the root node in the graph */
export function findRootNode(graph: ExecutionGraph): { id: string; node: RootNode } | null {
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "root") {
      return { id, node: node as RootNode };
    }
  }
  return null;
}

/** Check if graph has been created (planned) */
export function isGraphPlanned(graph: ExecutionGraph): boolean {
  const root = findRootNode(graph);
  if (root) {
    return root.node.graphCreated !== false;
  }
  // If no root node, check if there are other nodes
  return Object.keys(graph.nodes).length > 1;
}

/** Convenience: compute progress using the canonical function. */
export function computeGraphProgress(graph: ExecutionGraph): number {
  return computeProgress(graph);
}

export function buildGraphSummary(graph: ExecutionGraph): TaskGraphSummary {
  const root = findRootNode(graph);
  
  return {
    mode: graph.mode,
    graphVersion: graph.graphVersion,
    nodeCount: Object.keys(graph.nodes).length,
    progress: computeGraphProgress(graph),
    currentBlocker: findCurrentBlocker(graph),
    derivedStatus: deriveTaskStatus(graph),
    hasRootNode: root !== null,
    rootNodeId: root?.id ?? null,
  };
}

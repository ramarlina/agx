"use client";

import { create } from "zustand";
import type { ExecutionLifecycleState, ExecutionGraph, NodeStatus } from "@/src/graph/types";

interface GraphViewportState {
  x: number;
  y: number;
  zoom: number;
}

// Action that can be taken on a node based on its current state
export type NodeAction = 'start' | 'resume' | 'retry' | 'stop' | 'approve' | 'reject' | 'blocked' | 'none';

export function resolveNodeAction(status: NodeStatus): NodeAction {
  switch (status) {
    case 'pending':
      return 'start';
    case 'paused':
      return 'resume';
    case 'stopped':
    case 'failed':
      return 'retry';
    case 'blocked':
      return 'blocked';
    case 'running':
    case 'awaiting_human':
    case 'done':
    case 'passed':
    case 'skipped':
    default:
      return 'none';
  }
}

const TERMINAL_STATUSES: Set<NodeStatus> = new Set(['done', 'passed', 'skipped']);

function isPlanNode(nodeId: string, title: string): boolean {
  return nodeId === "plan" || /generate.*execution.*plan/i.test(title);
}

/** Returns true if all of a node's dependencies have reached a terminal success status. */
export function areDepsReady(nodeId: string, graph: ExecutionGraph): boolean {
  const node = graph.nodes[nodeId];
  if (!node) return false;
  return node.deps.every((depId) => {
    const dep = graph.nodes[depId];
    return dep && TERMINAL_STATUSES.has(dep.status);
  });
}

/** Graph-aware version of resolveNodeAction: returns 'none' if deps aren't ready. */
export function resolveNodeActionInGraph(nodeId: string, graph: ExecutionGraph): NodeAction {
  const node = graph.nodes[nodeId];
  if (!node) return 'none';
  if (node.type === "work" && node.status === "done" && isPlanNode(nodeId, String((node as { title?: unknown }).title || ""))) {
    return 'retry';
  }
  const action = resolveNodeAction(node.status);
  // Only allow start/blocked actions if deps are satisfied
  if ((action === 'start' || action === 'blocked') && !areDepsReady(nodeId, graph)) {
    return 'none';
  }
  return action;
}

// Cursor style based on node action
export function resolveNodeCursor(action: NodeAction): string {
  switch (action) {
    case 'start':
    case 'resume':
    case 'retry':
    case 'stop':
      return 'cursor-pointer';
    case 'blocked':
      return 'cursor-not-allowed';
    case 'none':
    default:
      return 'cursor-default';
  }
}

interface GraphUIState {
  // Node selection
  selectedNodeId: string | null;
  
  // Viewport state
  viewport: GraphViewportState;
  
  // Comparison mode for version history
  comparisonMode: boolean;
  comparisonFromVersion: number | null;
  comparisonToVersion: number | null;
  
  // Node triggering state
  triggeringNodeId: string | null;
  
  // Actions
  setSelectedNodeId: (nodeId: string | null) => void;
  setViewport: (viewport: GraphViewportState) => void;
  openComparison: (fromVersion: number, toVersion: number) => void;
  closeComparison: () => void;
  setTriggeringNodeId: (nodeId: string | null) => void;
  reset: () => void;
}

const DEFAULT_VIEWPORT: GraphViewportState = {
  x: 0,
  y: 0,
  zoom: 1,
};

export const useGraphUIStore = create<GraphUIState>((set) => ({
  selectedNodeId: null,
  viewport: DEFAULT_VIEWPORT,
  comparisonMode: false,
  comparisonFromVersion: null,
  comparisonToVersion: null,
  triggeringNodeId: null,
  
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setViewport: (viewport) => set({ viewport }),
  
  openComparison: (fromVersion, toVersion) =>
    set({
      comparisonMode: true,
      comparisonFromVersion: fromVersion,
      comparisonToVersion: toVersion,
    }),
    
  closeComparison: () =>
    set({
      comparisonMode: false,
      comparisonFromVersion: null,
      comparisonToVersion: null,
    }),
    
  setTriggeringNodeId: (nodeId) => set({ triggeringNodeId: nodeId }),
  
  reset: () =>
    set({
      selectedNodeId: null,
      viewport: DEFAULT_VIEWPORT,
      comparisonMode: false,
      comparisonFromVersion: null,
      comparisonToVersion: null,
      triggeringNodeId: null,
    }),
}));

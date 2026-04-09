"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  ControlButton,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
  applyNodeChanges,
} from "@xyflow/react";

import ConditionalNodeComponent from "@/components/graph/ConditionalNodeComponent";
import ForkNodeComponent from "@/components/graph/ForkNodeComponent";
import FunctionNodeComponent from "@/components/graph/FunctionNodeComponent";
import GateNodeComponent from "@/components/graph/GateNodeComponent";
import JoinNodeComponent from "@/components/graph/JoinNodeComponent";
import WorkNodeComponent from "@/components/graph/WorkNodeComponent";
import RootNodeComponent from "@/components/graph/RootNodeComponent";
import TaskDetailNodeComponent from "@/components/graph/TaskDetailNodeComponent";
import { getNodeLabel } from "@/components/graph/graph-derived";
import type { GraphFlowNode, TaskDetailNodeData } from "@/components/graph/graph-flow-types";
import { useGraphUIStore } from "@/components/graph/useGraphUIStore";
import type { ExecutionGraph, GraphNode, NodeStatus } from "@/src/graph/types";

const NODE_TYPES = {
  work: WorkNodeComponent,
  function: FunctionNodeComponent,
  gate: GateNodeComponent,
  fork: ForkNodeComponent,
  join: JoinNodeComponent,
  conditional: ConditionalNodeComponent,
  root: RootNodeComponent,
  taskDetail: TaskDetailNodeComponent,
};

const ACTIVE_STATUSES = new Set<NodeStatus>(["running", "awaiting_human"]);
const SUCCESS_STATUSES = new Set<NodeStatus>(["done", "passed"]);

export const TASK_DETAIL_NODE_ID = "__taskDetail__";
const TASK_DETAIL_NODE_SIZE = { width: 280, height: 120 };

interface ExecutionGraphPanelProps {
  graph: ExecutionGraph;
  taskId?: string;
  className?: string;
  fullscreen?: boolean;
  onNodeSelect?: (nodeId: string) => void;
  /** Stable summary data for the task detail node on the canvas. */
  taskDetailNode?: TaskDetailNodeData;
  /** Called when a node is clicked (to open a modal). */
  onNodeClick?: (nodeId: string) => void;
}

function resolveNodeSize(node: GraphNode): { width: number; height: number } {
  if (node.type === "root") {
    return { width: 240, height: 100 };
  }

  if (node.type === "work") {
    return { width: 220, height: 88 };
  }

  if (node.type === "function") {
    return { width: 200, height: 80 };
  }

  if (node.type === "gate") {
    return { width: 108, height: 108 };
  }

  if (node.type === "conditional") {
    return { width: 84, height: 84 };
  }

  return { width: 68, height: 68 };
}

/**
 * Compute the set of active edge indices.
 * All edges on the path leading to (and including) the current frontier
 * node(s) are considered active.
 */
function computeActiveEdges(graph: ExecutionGraph): Set<number> {
  const active = new Set<number>();
  const statuses = Object.values(graph.nodes).map((n) => n.status);

  // Determine frontier statuses in priority order
  const frontierStatus = statuses.includes("running")
    ? "running"
    : statuses.includes("awaiting_human")
      ? "awaiting_human"
      : null;

  if (!frontierStatus) {
    // Fallback: edges from done/passed source to pending target
    for (const [i, edge] of graph.edges.entries()) {
      const source = graph.nodes[edge.from];
      const target = graph.nodes[edge.to];
      if (source && target && SUCCESS_STATUSES.has(source.status) && target.status === "pending") {
        active.add(i);
      }
    }
    return active;
  }

  // Build reverse adjacency: nodeId → list of (edge index, source nodeId)
  const inbound = new Map<string, { idx: number; from: string }[]>();
  for (const [i, edge] of graph.edges.entries()) {
    if (!inbound.has(edge.to)) inbound.set(edge.to, []);
    inbound.get(edge.to)!.push({ idx: i, from: edge.from });
  }

  // BFS backwards from frontier nodes
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.status === frontierStatus) {
      queue.push(nodeId);
      visited.add(nodeId);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const { idx, from } of inbound.get(nodeId) ?? []) {
      const sourceNode = graph.nodes[from];
      // Only traverse through completed/success nodes
      if (!sourceNode || !SUCCESS_STATUSES.has(sourceNode.status)) continue;
      active.add(idx);
      if (!visited.has(from)) {
        visited.add(from);
        queue.push(from);
      }
    }
  }

  return active;
}

function buildLayoutedNodes(
  graph: ExecutionGraph,
  direction: "TB" | "LR",
  includeDetailNode: boolean,
  detailNodeData?: TaskDetailNodeData,
  selectedNodeId?: string | null,
): GraphFlowNode[] {
  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 48,
    ranksep: 84,
    marginx: 32,
    marginy: 32,
  });

  // When detail node replaces the task header, hide root + handoff gate
  const hiddenIds = new Set<string>();
  if (includeDetailNode) {
    for (const [id, n] of Object.entries(graph.nodes)) {
      if (n.type === "root") hiddenIds.add(id);
      if (n.type === "gate" && (n as any).gateType === "handoff_gate") hiddenIds.add(id);
    }
    dagreGraph.setNode(TASK_DETAIL_NODE_ID, {
      width: TASK_DETAIL_NODE_SIZE.width,
      height: TASK_DETAIL_NODE_SIZE.height,
    });
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (hiddenIds.has(nodeId)) continue;
    const { width, height } = resolveNodeSize(node);
    dagreGraph.setNode(nodeId, { width, height });
  }

  // Collect outgoing targets from all hidden nodes so detail node connects to them
  if (includeDetailNode) {
    const detailTargets = new Set<string>();
    for (const edge of graph.edges) {
      if (hiddenIds.has(edge.from) && !hiddenIds.has(edge.to)) {
        detailTargets.add(edge.to);
      }
    }
    for (const target of detailTargets) {
      dagreGraph.setEdge(TASK_DETAIL_NODE_ID, target);
    }
  }

  for (const edge of graph.edges) {
    if (hiddenIds.has(edge.from) || hiddenIds.has(edge.to)) continue;
    dagreGraph.setEdge(edge.from, edge.to);
  }

  dagre.layout(dagreGraph);

  const result: GraphFlowNode[] = [];

  if (includeDetailNode) {
    const layoutNode = dagreGraph.node(TASK_DETAIL_NODE_ID);
    result.push({
      id: TASK_DETAIL_NODE_ID,
      type: "taskDetail" as any,
      data: (detailNodeData || {}) as any,
      position: {
        x: (layoutNode?.x ?? 0) - TASK_DETAIL_NODE_SIZE.width / 2,
        y: (layoutNode?.y ?? 0) - TASK_DETAIL_NODE_SIZE.height / 2,
      },
      selectable: true,
    } as any);
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (hiddenIds.has(nodeId)) continue;
    const layoutNode = dagreGraph.node(nodeId);
    const { width, height } = resolveNodeSize(node);

    result.push({
      id: nodeId,
      type: node.type,
      data: {
        nodeId,
        node,
        label: getNodeLabel(nodeId, node),
      },
      position: {
        x: (layoutNode?.x ?? 0) - width / 2,
        y: (layoutNode?.y ?? 0) - height / 2,
      },
      selectable: true,
      selected: selectedNodeId === nodeId,
    } satisfies GraphFlowNode);
  }

  return result;
}

function buildFlowEdges(graph: ExecutionGraph, hasDetailNode?: boolean): Edge[] {
  const edges: Edge[] = [];

  // Build set of hidden node IDs (same logic as layout)
  const hiddenIds = new Set<string>();
  if (hasDetailNode) {
    for (const [id, n] of Object.entries(graph.nodes)) {
      if (n.type === "root") hiddenIds.add(id);
      if (n.type === "gate" && (n as any).gateType === "handoff_gate") hiddenIds.add(id);
    }
  }

  // Re-route: edges from hidden nodes to visible nodes come from the detail node
  if (hasDetailNode) {
    const detailTargets = new Set<string>();
    for (const edge of graph.edges) {
      if (hiddenIds.has(edge.from) && !hiddenIds.has(edge.to)) {
        detailTargets.add(edge.to);
      }
    }
    for (const target of detailTargets) {
      edges.push({
        id: `${TASK_DETAIL_NODE_ID}-${target}`,
        source: TASK_DETAIL_NODE_ID,
        target,
        type: "smoothstep",
        animated: false,
        className: "execution-edge",
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  }

  const activeEdges = computeActiveEdges(graph);

  for (const [index, edge] of graph.edges.entries()) {
    if (hiddenIds.has(edge.from) || hiddenIds.has(edge.to)) continue;

    const active = activeEdges.has(index);
    const soft = edge.type === "soft";
    edges.push({
      id: `${edge.from}-${edge.to}-${index}`,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      animated: active,
      className: `execution-edge ${soft ? "execution-edge--soft" : ""} ${active ? "execution-edge--active" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: soft ? { strokeDasharray: "6 4" } : undefined,
    } satisfies Edge);
  }

  return edges;
}

function getSavedPositions(graphId: string): Record<string, { x: number; y: number }> | null {
  try {
    const raw = localStorage.getItem(`graph-positions:${graphId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePositions(graphId: string, nodes: GraphFlowNode[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    positions[node.id] = node.position;
  }
  try {
    localStorage.setItem(`graph-positions:${graphId}`, JSON.stringify(positions));
  } catch { /* quota exceeded — ignore */ }
}

function clearSavedPositions(graphId: string) {
  localStorage.removeItem(`graph-positions:${graphId}`);
}

function applySavedPositions(nodes: GraphFlowNode[], graphId: string): GraphFlowNode[] {
  const saved = getSavedPositions(graphId);
  if (!saved) return nodes;
  return nodes.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n));
}

export default function ExecutionGraphPanel({
  graph,
  taskId,
  className,
  fullscreen = false,
  onNodeSelect,
  taskDetailNode,
  onNodeClick,
}: ExecutionGraphPanelProps) {
  const [direction, setDirection] = useState<"TB" | "LR">("LR");
  const flowRef = useRef<ReactFlowInstance<GraphFlowNode, Edge> | null>(null);
  const initialFitDone = useRef(false);

  const selectedNodeId = useGraphUIStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useGraphUIStore((state) => state.setSelectedNodeId);
  const setViewport = useGraphUIStore((state) => state.setViewport);

  const hasDetailNode = !!taskDetailNode;

  const dagreNodes = useMemo(
    () => buildLayoutedNodes(graph, direction, hasDetailNode, taskDetailNode, selectedNodeId),
    [graph, direction, hasDetailNode, taskDetailNode, selectedNodeId],
  );

  const [nodes, setNodes] = useState<GraphFlowNode[]>(() =>
    applySavedPositions(dagreNodes, graph.id),
  );

  // Sync when graph data or layout direction changes
  useEffect(() => {
    setNodes(applySavedPositions(dagreNodes, graph.id));
  }, [dagreNodes, graph.id]);

  const edges = useMemo(() => buildFlowEdges(graph, hasDetailNode), [graph, hasDetailNode]);

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphFlowNode>[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev));
    },
    [],
  );

  const onNodeDragStop = useCallback(() => {
    setNodes((current) => {
      savePositions(graph.id, current);
      return current;
    });
  }, [graph.id]);

  const resetLayout = useCallback(() => {
    clearSavedPositions(graph.id);
    setNodes(dagreNodes);
    setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 250 }), 0);
  }, [graph.id, dagreNodes]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!graph.nodes[selectedNodeId] && selectedNodeId !== TASK_DETAIL_NODE_ID) {
      setSelectedNodeId(null);
    }
  }, [graph.nodes, selectedNodeId, setSelectedNodeId]);

  const handleNodeClick = useCallback(async (
    _: React.MouseEvent,
    flowNode: GraphFlowNode
  ) => {
    const nodeId = flowNode.id;
    setSelectedNodeId(nodeId);
    onNodeSelect?.(nodeId);

    // Open modal on single click
    onNodeClick?.(nodeId);
  }, [setSelectedNodeId, onNodeSelect, onNodeClick]);

  return (
    <div
      className={`execution-graph-panel ${fullscreen ? "execution-graph-panel--fullscreen" : ""} ${className ?? ""}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(instance) => {
          flowRef.current = instance;
          initialFitDone.current = false;
        }}
        onMoveEnd={(_, nextViewport) => {
          if (!initialFitDone.current) {
            initialFitDone.current = true;
            return;
          }
          setViewport(nextViewport);
        }}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={handleNodeClick}
        panOnScroll
      >
        <Background gap={24} size={1.2} color="rgba(100, 116, 139, 0.25)" />
        <MiniMap pannable zoomable />
        <Controls>
          <ControlButton
            title="Fit graph"
            onClick={() => {
              flowRef.current?.fitView({ padding: 0.2, duration: 250 });
            }}
          >
            ⊡
          </ControlButton>
          <ControlButton
            title="Reset layout"
            onClick={resetLayout}
          >
            ↻
          </ControlButton>
          <ControlButton
            title="Toggle layout direction"
            onClick={() => {
              setDirection((prev) => (prev === "TB" ? "LR" : "TB"));
            }}
          >
            {direction}
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}

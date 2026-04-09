import type { Node } from "@xyflow/react";

import type { GraphNode, NodeType } from "@/src/graph/types";

export interface GraphFlowNodeData extends Record<string, unknown> {
  nodeId: string;
  node: GraphNode;
  label: string;
}

export type GraphFlowNode = Node<GraphFlowNodeData, NodeType | "taskDetail">;

export interface TaskDetailNodeData extends Record<string, unknown> {
  taskId: string;
  title: string;
  description: string;
  status: string;
  stage?: string;
}

export type TaskDetailFlowNode = Node<TaskDetailNodeData, "taskDetail">;

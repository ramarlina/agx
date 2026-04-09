"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { toNodeStatusClass } from "@/components/graph/graph-derived";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";

export default function ConditionalNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const statusClass = toNodeStatusClass(data.node.status);

  return (
    <div
      className={`conditional-node ${statusClass} ${selected ? "execution-node--selected" : ""}`}
      title="Conditional"
    >
      <Handle type="target" position={Position.Left} className="execution-node__handle" />
      <div className="conditional-node__content">?</div>
      <Handle type="source" position={Position.Right} className="execution-node__handle" />
    </div>
  );
}

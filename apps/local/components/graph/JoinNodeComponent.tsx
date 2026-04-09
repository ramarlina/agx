"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { toNodeStatusClass } from "@/components/graph/graph-derived";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";

export default function JoinNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const statusClass = toNodeStatusClass(data.node.status);

  return (
    <div
      className={`execution-node execution-node--circle execution-node--join ${statusClass} ${selected ? "execution-node--selected" : ""}`}
      title="Join"
    >
      <Handle type="target" position={Position.Left} className="execution-node__handle" />
      <div className="execution-node__glyph" aria-hidden>
        ⇇
      </div>
      <Handle type="source" position={Position.Right} className="execution-node__handle" />
    </div>
  );
}

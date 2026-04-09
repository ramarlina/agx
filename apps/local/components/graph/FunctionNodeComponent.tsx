"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { formatNodeStatusLabel, toNodeStatusClass } from "@/components/graph/graph-derived";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";
import type { FunctionNode } from "@/src/graph/types";

export default function FunctionNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const node = data.node as FunctionNode;
  const statusClass = toNodeStatusClass(node.status);
  const kindLabel = node.kind === "mcp" ? "MCP" : "Bash";

  return (
    <div
      className={`execution-node execution-node--function ${statusClass} ${selected ? "execution-node--selected" : ""}`}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="execution-node__handle" />

      <div className="execution-node__header">
        <div className="execution-node__title">{data.label}</div>
        <span className="execution-node__badge">{kindLabel}</span>
      </div>

      <div className="execution-node__meta">
        <span className="execution-node__status">{formatNodeStatusLabel(node.status)}</span>
        {node.timeoutMs && (
          <span className="execution-node__status">timeout {Math.round(node.timeoutMs / 1000)}s</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="execution-node__handle" />
    </div>
  );
}

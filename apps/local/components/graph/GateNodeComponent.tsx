"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import {
  formatNodeStatusLabel,
  getNodeLabel,
  toNodeStatusClass,
} from "@/components/graph/graph-derived";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";

export default function GateNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const gate = data.node.type === "gate" ? data.node : null;
  const statusClass = toNodeStatusClass(data.node.status);
  const label = gate ? getNodeLabel(data.nodeId, gate) : data.label;

  return (
    <div
      className={`gate-node ${statusClass} ${gate?.required ? "gate--required" : ""} ${selected ? "execution-node--selected" : ""}`}
      title={label}
    >
      <Handle type="target" position={Position.Left} className="execution-node__handle" />
      <div className="gate-node__content">
        <div className="execution-node__title">{label}</div>
        <div className="execution-node__meta">
          <span className="execution-node__status">{formatNodeStatusLabel(data.node.status)}</span>
          {gate?.required ? <span className="execution-node__status">required</span> : null}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="execution-node__handle" />
    </div>
  );
}

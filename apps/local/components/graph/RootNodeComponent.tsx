"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { formatNodeStatusLabel, toNodeStatusClass } from "@/components/graph/graph-derived";
import { resolveNodeAction, resolveNodeCursor } from "@/components/graph/useGraphUIStore";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";
import { sanitizeTaskObjective } from "@/src/graph/objective";
import type { RootNode } from "@/src/graph/types";

export default function RootNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const node = data.node as RootNode;
  const statusClass = toNodeStatusClass(node.status);
  const action = resolveNodeAction(node.status);
  const cursorClass = resolveNodeCursor(action);

  const getActionHint = () => {
    switch (action) {
      case 'start':
        return 'Click to create plan';
      case 'resume':
        return 'Click to resume';
      case 'retry':
        return 'Click to retry';
      case 'blocked':
        return 'Dependencies not met';
      default:
        return null;
    }
  };

  const actionHint = getActionHint();
  const objective = sanitizeTaskObjective(node.objective, node.title);

  return (
    <div
      className={`execution-node execution-node--root ${statusClass} ${selected ? "execution-node--selected" : ""} ${cursorClass}`}
      title={objective || data.label}
    >
      <Handle type="source" position={Position.Right} className="execution-node__handle" />
      
      <div className="execution-node__root-badge">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        ROOT
      </div>
      
      <div className="execution-node__title">{data.label}</div>
      
      {node.graphCreated === false && (
        <div className="execution-node__subtitle">No plan yet</div>
      )}
      
      <div className="execution-node__meta">
        <span className="execution-node__status">{formatNodeStatusLabel(node.status)}</span>
        {node.criteria && node.criteria.length > 0 && (
          <span className="execution-node__status">{node.criteria.length} criteria</span>
        )}
      </div>
      
      {actionHint && (
        <div className="execution-node__action-hint">{actionHint}</div>
      )}
    </div>
  );
}

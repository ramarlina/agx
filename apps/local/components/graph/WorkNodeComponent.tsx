"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { formatNodeStatusLabel, toNodeStatusClass } from "@/components/graph/graph-derived";
import { resolveNodeAction, resolveNodeCursor, useGraphUIStore } from "@/components/graph/useGraphUIStore";
import type { GraphFlowNode } from "@/components/graph/graph-flow-types";
import type { WorkNode } from "@/src/graph/types";

function resolveDisplayLabel(label: string): string {
  const trimmed = label.trim();
  // If the label looks like JSON, try to extract a meaningful title
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Try common title-like keys from decision output
        const title = parsed.summary || parsed.decision || parsed.explanation;
        if (typeof title === "string" && title.length > 0) {
          return title.length > 60 ? title.slice(0, 57) + "..." : title;
        }
      }
    } catch {
      // Not valid JSON — truncate the raw string
    }
    return trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
  }
  return label;
}

export default function WorkNodeComponent({ data, selected }: NodeProps<GraphFlowNode>) {
  const node = data.node as WorkNode;
  const triggeringNodeId = useGraphUIStore((state) => state.triggeringNodeId);
  const isTriggering = triggeringNodeId === data.nodeId;
  const isRetryQueued =
    node.status === "pending" &&
    Number(node.attempts) > 0 &&
    Number(node.attempts) < Number(node.maxAttempts);
  
  const statusClass = toNodeStatusClass(node.status);
  const action = resolveNodeAction(node.status);
  const cursorClass = resolveNodeCursor(action);
  const attempts = `${node.attempts}/${node.maxAttempts}`;
  const displayLabel = resolveDisplayLabel(data.label);
  const statusLabel = isRetryQueued ? "retry queued" : formatNodeStatusLabel(node.status);

  const getActionIcon = () => {
    switch (action) {
      case 'start':
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        );
      case 'resume':
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        );
      case 'retry':
        return (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'blocked':
        return (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const actionIcon = getActionIcon();

  return (
    <div
      className={`execution-node execution-node--work ${statusClass} ${selected ? "execution-node--selected" : ""} ${cursorClass} ${isTriggering ? "execution-node--triggering" : ""}`}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="execution-node__handle" />
      
      <div className="execution-node__header">
        <div className="execution-node__title">{displayLabel}</div>
        {actionIcon && (
          <div className="execution-node__action-icon">
            {actionIcon}
          </div>
        )}
      </div>
      
      <div className="execution-node__meta">
        <span
          className={`execution-node__status ${isRetryQueued ? "execution-node__status--retry" : ""}`}
        >
          {statusLabel}
        </span>
        <span className="execution-node__status">attempt {attempts}</span>
        {node.estimateMinutes && (
          <span className="execution-node__status">~{node.estimateMinutes}m</span>
        )}
      </div>
      {isRetryQueued ? (
        <div className="execution-node__hint">Previous attempt failed. Waiting to retry.</div>
      ) : null}
      
      <Handle type="source" position={Position.Right} className="execution-node__handle" />
    </div>
  );
}

"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { TaskDetailFlowNode } from "@/components/graph/graph-flow-types";

const statusColors: Record<string, string> = {
  queued: "bg-[var(--status-queued)] text-[var(--status-queued)]",
  in_progress: "bg-[var(--status-in-progress)] text-[var(--status-in-progress)]",
  blocked: "bg-[var(--status-blocked)] text-[var(--status-blocked)]",
  completed: "bg-[var(--status-completed)] text-[var(--status-completed)]",
  failed: "bg-[var(--status-failed)] text-[var(--status-failed)]",
};

function TaskDetailNodeComponent({ data, selected }: NodeProps<TaskDetailFlowNode>) {
  const { title, status, stage, description } = data;

  const statusDotColor = statusColors[status] || "bg-[var(--muted-foreground)]";
  // Extract just the dot bg class
  const dotClass = statusDotColor.split(" ")[0];
  const preview = description
    ? description.replace(/[#*_`>\-\[\]()]/g, "").slice(0, 120)
    : "";

  return (
    <div
      className={`task-detail-node ${selected ? "task-detail-node--selected" : ""}`}
      title="Double-click to open details"
    >
      <Handle type="source" position={Position.Right} className="execution-node__handle" />

      {/* Header with status dot */}
      <div className="task-detail-node__header">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass} ${status === "in_progress" ? "animate-pulse" : ""}`} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex-shrink-0">
            Task
          </span>
          {stage && (
            <>
              <span className="text-[var(--muted-foreground)] opacity-40">·</span>
              <span className="text-[10px] capitalize text-[var(--muted-foreground)]">{stage}</span>
            </>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="task-detail-node__title">{title || "Untitled"}</div>

      {/* Description preview */}
      {preview && (
        <div className="task-detail-node__preview">{preview}{description && description.length > 120 ? "..." : ""}</div>
      )}
    </div>
  );
}

export default memo(TaskDetailNodeComponent);

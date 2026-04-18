"use client";

import { useState } from "react";
import ExecutionBudgetBar from "@/components/graph/ExecutionBudgetBar";
import GraphVersionHistory from "@/components/graph/GraphVersionHistory";
import NodeInspector from "@/components/graph/NodeInspector";
import { getNodeLabel, formatNodeStatusLabel } from "@/components/graph/graph-derived";
import { useGraphUIStore } from "@/components/graph/useGraphUIStore";
import TerminalLogStream from "@/components/TerminalLogStream";
import LogTimeline from "@/components/LogTimeline";
import type { ExecutionGraph, GraphNode } from "@/src/graph/types";
import type { Task } from "./TaskCard";

const TASK_DETAIL_NODE_ID = "__taskDetail__";

interface TaskDetailSidebarData {
  taskId: string;
  status: string;
  comments: Array<{ id: string; task_id: string; author_type?: "user" | "agent"; author_id?: string; content: string; created_at: string }>;
  onAddComment: (content: string) => void;
  onDeleteComment?: (commentId: string) => Promise<void>;
}

interface GraphDetailSidebarProps {
  graph: ExecutionGraph;
  task: Task;
  style?: React.CSSProperties;
  className?: string;
  taskDetailSidebarData?: TaskDetailSidebarData;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function findActiveNode(graph: ExecutionGraph): { id: string; node: GraphNode } | null {
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.status === "running" || node.status === "awaiting_human") {
      return { id, node };
    }
  }
  return null;
}

export default function GraphDetailSidebar({ graph, task, style, className, taskDetailSidebarData }: GraphDetailSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const selectedNodeId = useGraphUIStore((state) => state.selectedNodeId);
  const isTaskDetailSelected = selectedNodeId === TASK_DETAIL_NODE_ID;
  const activeNode = findActiveNode(graph);
  const gateNodes = Object.entries(graph.nodes).filter(([, n]) => n.type === "gate");

  return (
    <div
      style={style}
      className={`border-l border-[var(--card-border)] bg-[var(--muted)]/20 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-4 flex-shrink-0 ${className || ""}`}
    >

      {/* Task Detail panel — shown when the detail node is selected */}
      {isTaskDetailSelected && taskDetailSidebarData ? (
        <TaskDetailPanel data={taskDetailSidebarData} />
      ) : (
        /* Selected Node Inspector */
        <NodeInspector graph={graph} />
      )}

      {/* Active Node */}
      <SidebarSection title="Active Node" collapsed={collapsed["active"]} onToggle={() => toggle("active")}>
        {activeNode ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{getNodeLabel(activeNode.id, activeNode.node)}</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[var(--status-in-progress-bg)] text-[var(--status-in-progress)]">
                {formatNodeStatusLabel(activeNode.node.status)}
              </span>
            </div>
            {activeNode.node.type === "work" && (
              <div className="text-xs text-[var(--muted-foreground)] space-y-1">
                <div className="flex justify-between">
                  <span>Attempts</span>
                  <span className="font-mono">{activeNode.node.attempts}/{activeNode.node.maxAttempts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Started</span>
                  <span>{formatTimestamp(activeNode.node.startedAt)}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No node currently running.</p>
        )}
      </SidebarSection>

      {/* Budgets */}
      <SidebarSection title="Budgets" collapsed={collapsed["budgets"]} onToggle={() => toggle("budgets")}>
        <ExecutionBudgetBar policy={graph.policy} />
      </SidebarSection>

      {/* Gates */}
      {gateNodes.length > 0 && (
        <SidebarSection title="Gates" collapsed={collapsed["gates"]} onToggle={() => toggle("gates")}>
          <div className="space-y-2">
            {gateNodes.map(([id, node]) => {
              if (node.type !== "gate") return null;
              return (
                <div key={id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <GateStatusDot status={node.status} />
                    <span className="truncate">{getNodeLabel(id, node)}</span>
                    {node.required && (
                      <span className="text-[9px] uppercase font-bold px-1 py-px rounded bg-[var(--destructive-muted)] text-[var(--destructive)]">
                        req
                      </span>
                    )}
                  </div>
                  <span className="text-[var(--muted-foreground)] capitalize">{formatNodeStatusLabel(node.status)}</span>
                </div>
              );
            })}
          </div>
        </SidebarSection>
      )}

      {/* History */}
      <SidebarSection title="Version History" collapsed={collapsed["history"]} onToggle={() => toggle("history")}>
        {graph.versionHistory.length > 0 ? (
          <GraphVersionHistory graph={graph} />
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No replan or rollback events yet.</p>
        )}
      </SidebarSection>

      {/* Task Properties */}
      <SidebarSection title="Task" collapsed={collapsed["task"]} onToggle={() => toggle("task")}>
        <div className="text-xs space-y-1.5">
          <PropRow label="ID" value={task.identifier || task.slug || task.id.slice(0, 8)} mono />
          <PropRow label="Stage" value={task.stage || "N/A"} />
          <PropRow label="Status" value={task.status || "queued"} />
          <PropRow label="Created" value={formatTimestamp(task.created_at)} />
        </div>
      </SidebarSection>
    </div>
  );
}

function TaskDetailPanel({ data }: { data: TaskDetailSidebarData }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Task Details</div>

      {/* Terminal Log Stream */}
      <div>
        <TerminalLogStream taskId={data.taskId} status={data.status} />
      </div>

      {/* Comments */}
      <div className="border-t border-[var(--card-border)] pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 flex items-center justify-between">
          <span>Comments</span>
          <span className="text-[10px] bg-[var(--muted)] px-2 py-0.5 rounded-full">{data.comments.length}</span>
        </h4>
        <LogTimeline comments={data.comments} onAddComment={data.onAddComment} onDeleteComment={data.onDeleteComment} />
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}

function PropRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className={`font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function GateStatusDot({ status }: { status: string }) {
  const color =
    status === "passed"
      ? "bg-[var(--status-completed)]"
      : status === "failed"
        ? "bg-[var(--status-failed)]"
        : status === "running" || status === "awaiting_human"
          ? "bg-[var(--status-in-progress)] animate-pulse"
          : "bg-[var(--muted-foreground)]/40";

  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

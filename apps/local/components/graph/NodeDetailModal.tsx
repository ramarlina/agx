"use client";

import { useEffect, useRef } from "react";

import RichTextEditor from "@/components/RichTextEditor";
import TerminalLogStream from "@/components/TerminalLogStream";
import LogTimeline from "@/components/LogTimeline";
import { formatNodeStatusLabel, getNodeLabel } from "@/components/graph/graph-derived";
import { sanitizeTaskObjective } from "@/src/graph/objective";
import type { ExecutionGraph, WorkNode, RootNode, GateNode } from "@/src/graph/types";

interface TaskComment {
  id: string;
  task_id: string;
  author_type?: "user" | "agent";
  author_id?: string;
  content: string;
  created_at: string;
}

interface TaskDetailModalContent {
  type: "taskDetail";
  taskId: string;
  title: string;
  description: string;
  status: string;
  failureMessage?: string;
  blockedMessage?: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRetry: () => void;
  onUnblock: () => void;
  comments: TaskComment[];
  onAddComment: (content: string) => void;
  onDeleteComment?: (commentId: string) => Promise<void>;
}

interface GraphNodeModalContent {
  type: "graphNode";
  nodeId: string;
  graph: ExecutionGraph;
}

export type NodeModalContent = TaskDetailModalContent | GraphNodeModalContent;

interface NodeDetailModalProps {
  content: NodeModalContent;
  onClose: () => void;
}

function formatTimestamp(value?: string): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function NodeDetailModal({ content, onClose }: NodeDetailModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fade-in"
    >
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl w-[min(90vw,800px)] max-h-[85vh] flex flex-col animate-scale-in">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border)] flex-shrink-0">
          <h3 className="text-sm font-bold truncate">
            {content.type === "taskDetail"
              ? "Task Details"
              : getNodeLabel(content.nodeId, content.graph.nodes[content.nodeId])}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--muted)]/60 rounded-lg transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {content.type === "taskDetail" ? (
            <TaskDetailBody content={content} />
          ) : (
            <GraphNodeBody nodeId={content.nodeId} graph={content.graph} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Task Detail Body ─────────────────────────────────────────────────

function TaskDetailBody({ content }: { content: TaskDetailModalContent }) {
  return (
    <div className="p-6 space-y-6">
      {/* Status banners */}
      {content.status === "failed" && (
        <div className="p-3 rounded-lg bg-[var(--status-failed-bg)] border border-[var(--status-failed)] text-[var(--status-failed)] text-sm">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider">Task Failed</span>
            <button onClick={content.onRetry} className="text-xs font-bold uppercase hover:underline">Retry</button>
          </div>
          <p className="text-xs mt-1">{content.failureMessage || "Task marked failed."}</p>
        </div>
      )}
      {content.status === "blocked" && (
        <div className="p-3 rounded-lg bg-[var(--status-blocked-bg)] border border-[var(--status-blocked)] text-[var(--status-blocked)] text-sm">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider">Blocked</span>
            <button onClick={content.onUnblock} className="text-xs font-bold uppercase hover:underline">Unblock</button>
          </div>
          <p className="text-xs mt-1">{content.blockedMessage || "Task is blocked."}</p>
        </div>
      )}

      {/* Title */}
      <input
        type="text"
        value={content.title}
        onChange={(e) => content.onTitleChange(e.target.value)}
        placeholder="Task title..."
        className="w-full text-xl font-bold bg-transparent border-none outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
      />

      {/* Description */}
      <div className="min-h-[100px]">
        <RichTextEditor
          content={content.description}
          onChange={content.onDescriptionChange}
          placeholder="Add more detail to this task..."
        />
      </div>

      {/* Terminal */}
      <div className="border-t border-[var(--card-border)] pt-6">
        <TerminalLogStream taskId={content.taskId} status={content.status} />
      </div>

      {/* Comments */}
      <div className="border-t border-[var(--card-border)] pt-6">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-4 flex items-center justify-between">
          <span>Comments</span>
          <span className="text-[10px] bg-[var(--muted)] px-2 py-0.5 rounded-full">{content.comments.length}</span>
        </h4>
        <LogTimeline comments={content.comments} onAddComment={content.onAddComment} onDeleteComment={content.onDeleteComment} />
      </div>
    </div>
  );
}

// ── Graph Node Body ──────────────────────────────────────────────────

function GraphNodeBody({ nodeId, graph }: { nodeId: string; graph: ExecutionGraph }) {
  const node = graph.nodes[nodeId];
  if (!node) return <div className="p-6 text-sm text-[var(--muted-foreground)]">Node not found.</div>;

  return (
    <div className="p-6 space-y-4">
      {/* Status + type */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">{node.type}</span>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded node-inspector__status--${node.status}`}>
          {formatNodeStatusLabel(node.status)}
        </span>
      </div>

      {/* Properties grid */}
      <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
        <span className="text-[var(--muted-foreground)]">Node ID</span>
        <code className="text-xs font-mono">{nodeId}</code>

        <span className="text-[var(--muted-foreground)]">Dependencies</span>
        <span>{node.deps.length > 0 ? node.deps.join(", ") : "None"}</span>

        <span className="text-[var(--muted-foreground)]">Started</span>
        <span>{formatTimestamp(node.startedAt)}</span>

        <span className="text-[var(--muted-foreground)]">Completed</span>
        <span>{formatTimestamp(node.completedAt)}</span>
      </div>

      {/* Type-specific sections */}
      {node.type === "root" && <RootSection node={node as RootNode} />}
      {node.type === "work" && <WorkSection node={node as WorkNode} />}
      {node.type === "gate" && <GateSection node={node as GateNode} />}
    </div>
  );
}

function RootSection({ node }: { node: RootNode }) {
  const objective = sanitizeTaskObjective(node.objective, node.title);

  return (
    <div className="border-t border-[var(--card-border)] pt-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Objective</h4>
      <p className="text-sm">{objective || "No objective defined."}</p>
      {node.criteria && node.criteria.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">Success Criteria</h5>
          <ul className="space-y-1">
            {node.criteria.map((c, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-[var(--muted-foreground)] mt-1">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WorkSection({ node }: { node: WorkNode }) {
  return (
    <div className="border-t border-[var(--card-border)] pt-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Work Node</h4>
      {node.description && <p className="text-sm">{node.description}</p>}
      <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
        {node.workType && (
          <>
            <span className="text-[var(--muted-foreground)]">Work Type</span>
            <span>{node.workType}</span>
          </>
        )}
        <span className="text-[var(--muted-foreground)]">Attempts</span>
        <span>{node.attempts} / {node.maxAttempts}</span>
        <span className="text-[var(--muted-foreground)]">Retry Policy</span>
        <span>{node.retryPolicy.onExhaust}</span>
        {node.estimateMinutes !== undefined && (
          <>
            <span className="text-[var(--muted-foreground)]">Estimate</span>
            <span>{node.estimateMinutes}m</span>
          </>
        )}
      </div>
      <PlanList title="Where" items={node.where} />
      <PlanList title="What Changes" items={node.whatChanges} />
      <PlanList title="Acceptance Criteria" items={node.acceptanceCriteria} />
      <PlanList title="To Dos" items={node.todos} />
      <PlanList title="Verification" items={node.verification} />
      {node.output && Object.keys(node.output).length > 0 && (
        <details className="mt-2">
          <summary className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] cursor-pointer">Output</summary>
          <pre className="mt-2 text-xs font-mono bg-[var(--muted)]/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
            {JSON.stringify(node.output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function PlanList({ title, items }: { title: string; items?: string[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">{title}</h5>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className="text-sm flex items-start gap-2">
            <span className="text-[var(--muted-foreground)] mt-1">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GateSection({ node }: { node: GateNode }) {
  return (
    <div className="border-t border-[var(--card-border)] pt-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Gate</h4>
      <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
        <span className="text-[var(--muted-foreground)]">Gate Type</span>
        <span>{node.gateType}</span>
        <span className="text-[var(--muted-foreground)]">Required</span>
        <span>{node.required ? "Yes" : "No"}</span>
        <span className="text-[var(--muted-foreground)]">Strategy</span>
        <span>{node.verificationStrategy.type}</span>
      </div>
      {node.verificationStrategy.checks && node.verificationStrategy.checks.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">Checks</h5>
          <ul className="space-y-1">
            {node.verificationStrategy.checks.map((check, i) => {
              const result = node.verificationResult?.checks?.find((r) => r.check === check);
              return (
                <li key={i} className="text-sm flex items-center gap-2">
                  <span className={result ? (result.passed ? "text-green-600" : "text-red-600") : "text-[var(--muted-foreground)]"}>
                    {result ? (result.passed ? "✓" : "✗") : "○"}
                  </span>
                  <span>{check}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

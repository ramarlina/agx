"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import ExecutionGraphPanel from "@/components/graph/ExecutionGraphPanel";
import ExecutionControls from "@/components/graph/ExecutionControls";
import NodeInspector from "@/components/graph/NodeInspector";
import NodeDetailPanel from "@/components/graph/NodeDetailPanel";
import GraphVersionHistory from "@/components/graph/GraphVersionHistory";
import GraphComparisonModal from "@/components/graph/GraphComparisonModal";
import { findRootNode } from "@/components/graph/graph-derived";
import { useGraphUIStore, type NodeAction } from "@/components/graph/useGraphUIStore";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import type { ExecutionGraph, ExecutionLifecycleState } from "@/src/graph/types";
import type { Task } from "@/components/TaskCard";

interface GraphFirstViewProps {
  task: Task;
  graph: ExecutionGraph;
  projectSlug: string;
  onClose: () => void;
  onRefetch: () => Promise<void>;
  onTaskUpdate?: (updates: Partial<Task>) => Promise<void>;
  onDeleteTask?: () => Promise<void>;
  isDeletingTask?: boolean;
}

function extractBodyFromContent(content?: string): string {
  const raw = String(content || "");
  if (!raw.trim()) return "";
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  const body = match ? match[1] : raw;
  return body.replace(/^#\s+.+(\r?\n|$)/, "").trim();
}

export default function GraphFirstView({
  task,
  graph,
  projectSlug,
  onClose,
  onRefetch,
  onTaskUpdate,
  onDeleteTask,
  isDeletingTask = false,
}: GraphFirstViewProps) {
  const { isTouchLayout } = useInputCapabilities();
  const [showLogs, setShowLogs] = useState(false);
  const [logsNodeId, setLogsNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showTaskDetails, setShowTaskDetails] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title || "");
  const [draftDesc, setDraftDesc] = useState(task.description || extractBodyFromContent(task.content));
  const [isSavingTaskDetails, setIsSavingTaskDetails] = useState(false);
  const [taskDetailsError, setTaskDetailsError] = useState<string | null>(null);
  
  const resetGraphUi = useGraphUIStore((state) => state.reset);
  const selectedNodeId = useGraphUIStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useGraphUIStore((state) => state.setSelectedNodeId);
  
  const rootNode = findRootNode(graph);
  
  // Reset UI state on mount only
  useEffect(() => {
    resetGraphUi();
    if (rootNode) {
      setSelectedNodeId(rootNode.id);
    }
    return () => resetGraphUi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Open detail panel when a node is selected (via click)
  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowDetailPanel(true);
  }, [setSelectedNodeId]);
  
  // Close detail panel
  const handleCloseDetailPanel = useCallback(() => {
    setShowDetailPanel(false);
  }, []);
  
  // Handle idempotent node triggering
  const handleNodeTrigger = useCallback(async (nodeId: string, action: NodeAction) => {
    setError(null);
    
    try {
      let endpoint: string;
      
      switch (action) {
        case 'start':
          endpoint = `/api/tasks/${task.id}/nodes/${nodeId}/start`;
          break;
        case 'resume':
          endpoint = `/api/tasks/${task.id}/nodes/${nodeId}/resume`;
          break;
        case 'retry':
          endpoint = `/api/tasks/${task.id}/nodes/${nodeId}/start`;
          break;
        case 'stop':
          endpoint = `/api/tasks/${task.id}/nodes/${nodeId}/stop`;
          break;
        case 'approve':
        case 'reject':
          endpoint = `/api/tasks/${task.id}/nodes/${nodeId}/verify`;
          break;
        default:
          return;
      }

      const isVerify = action === 'approve' || action === 'reject';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: task.project_id,
          ifMatchGraphVersion: graph.graphVersion,
          ...(isVerify && { approved: action === 'approve' }),
        }),
      });
      
      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        throw new Error(data?.error || `Failed to ${action} node`);
      }
      
      // Refetch graph data
      await onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} node`);
    }
  }, [task.id, task.project_id, graph.graphVersion, onRefetch]);
  
  // Handle execution state changes
  const handleExecutionStateChange = useCallback(async (newState: ExecutionLifecycleState) => {
    // Map execution state to task status
    const statusMap: Record<ExecutionLifecycleState, Task['status']> = {
      ready: 'queued',
      running: 'queued',
      paused: 'in_progress',
      stopped: 'blocked',
      done: 'completed',
    };
    
    const newStatus = statusMap[newState];
    if (newStatus && onTaskUpdate) {
      await onTaskUpdate({ status: newStatus });
    }
  }, [onTaskUpdate]);
  
  const handleShowLogs = useCallback((nodeId: string) => {
    setLogsNodeId(nodeId);
    setShowLogs(true);
  }, []);

  const handleSaveTitle = useCallback(async () => {
    setTaskDetailsError(null);
    if (draftTitle === task.title) {
      setEditingTitle(false);
      return;
    }
    if (!onTaskUpdate) {
      setEditingTitle(false);
      return;
    }
    try {
      setIsSavingTaskDetails(true);
      await onTaskUpdate({ title: draftTitle });
      setEditingTitle(false);
    } catch (err) {
      setTaskDetailsError(err instanceof Error ? err.message : "Failed to save title");
    } finally {
      setIsSavingTaskDetails(false);
    }
  }, [draftTitle, task.title, onTaskUpdate]);

  const handleSaveDesc = useCallback(async () => {
    setTaskDetailsError(null);
    const currentDescription = (task.description || extractBodyFromContent(task.content)).trim();
    if (draftDesc.trim() === currentDescription) {
      setEditingDesc(false);
      return;
    }
    if (!onTaskUpdate) {
      setEditingDesc(false);
      return;
    }
    try {
      setIsSavingTaskDetails(true);
      await onTaskUpdate({ description: draftDesc });
      setEditingDesc(false);
    } catch (err) {
      setTaskDetailsError(err instanceof Error ? err.message : "Failed to save description");
    } finally {
      setIsSavingTaskDetails(false);
    }
  }, [draftDesc, task.description, task.content, onTaskUpdate]);
  
  return (
    <div className="graph-first-view">
      {/* Header */}
      <header className="graph-first-view__header">
        <div className="graph-first-view__nav">
          <button
            onClick={onClose}
            className="graph-first-view__back"
            title="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="graph-first-view__breadcrumbs">
            <Link href={`/projects/${projectSlug}`} className="graph-link-button">
              {projectSlug}
            </Link>
            <span>/</span>
            <span className="font-medium">{task.title || task.slug || task.id.slice(0, 8)}</span>
          </div>
        </div>
        
        <div className="graph-first-view__title-row">
          <h1 className="graph-first-view__title">
            {task.title || "Untitled Task"}
          </h1>

          <div className="flex items-center gap-2">
            <ExecutionControls
              graph={graph}
              taskId={task.id}
              onStateChange={handleExecutionStateChange}
              onRefetch={onRefetch}
            />
            {onDeleteTask && (
              <button
                type="button"
                className="btn btn-destructive"
                onClick={() => {
                  void onDeleteTask();
                }}
                disabled={isDeletingTask}
              >
                {isDeletingTask ? "Deleting..." : "Delete Task"}
              </button>
            )}
          </div>
        </div>
        
        {error && (
          <div className="graph-first-view__error">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-sm underline">
              Dismiss
            </button>
          </div>
        )}
      </header>
      
      {/* Main content area */}
      <div className="graph-first-view__body">
        {/* Graph canvas (main area) */}
        <div className="graph-first-view__canvas">
          <ExecutionGraphPanel
            graph={graph}
            taskId={task.id}
            className="h-full"
            fullscreen
            onNodeSelect={handleNodeSelect}

          />
        </div>
        
        {/* Right sidebar - node details */}
        {!isTouchLayout ? (
          <aside className="graph-first-view__sidebar">
          {/* Collapsible task details */}
          <div className="graph-sidebar-section">
            <button
              className="graph-sidebar-section__toggle"
              onClick={() => setShowTaskDetails((v) => !v)}
            >
              <svg
                className={`w-4 h-4 transition-transform ${showTaskDetails ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium text-sm">Task Details</span>
            </button>

            {showTaskDetails && (
              <div className="graph-sidebar-section__body">
                {/* Title */}
                <label className="text-xs text-[var(--muted-foreground)]">Title</label>
                {editingTitle ? (
                  <input
                    className="w-full px-2 py-1 text-sm bg-[var(--card-bg)] border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                    disabled={isSavingTaskDetails}
                    autoFocus
                  />
                ) : (
                  <p
                    className="text-sm cursor-pointer hover:text-[var(--primary)] transition-colors"
                    onClick={() => { setDraftTitle(task.title || ""); setEditingTitle(true); }}
                  >
                    {task.title || "Untitled"}
                  </p>
                )}

                {/* Description */}
                <label className="text-xs text-[var(--muted-foreground)] mt-2">Description</label>
                {editingDesc ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full px-2 py-1 text-sm bg-[var(--card-bg)] border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--primary)] min-h-[60px] resize-y"
                      value={draftDesc}
                      onChange={(e) => setDraftDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveDesc();
                        }
                      }}
                      disabled={isSavingTaskDetails}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleSaveDesc()}
                        disabled={isSavingTaskDetails}
                      >
                        {isSavingTaskDetails ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setTaskDetailsError(null);
                          setDraftDesc(task.description || extractBodyFromContent(task.content));
                          setEditingDesc(false);
                        }}
                        disabled={isSavingTaskDetails}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm cursor-pointer hover:text-[var(--primary)] transition-colors whitespace-pre-wrap"
                    onClick={() => {
                      setTaskDetailsError(null);
                      setDraftDesc(task.description || extractBodyFromContent(task.content));
                      setEditingDesc(true);
                    }}
                  >
                    {task.description || extractBodyFromContent(task.content) || "No description"}
                  </p>
                )}
                {taskDetailsError && (
                  <p className="text-xs text-[var(--danger)]">{taskDetailsError}</p>
                )}

                {/* Properties */}
                <div className="mt-2 space-y-1 text-xs text-[var(--muted-foreground)]">
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className="text-[var(--foreground)]">{task.status || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Stage</span>
                    <span className="text-[var(--foreground)]">{task.stage || "—"}</span>
                  </div>
                  {task.slug && (
                    <div className="flex justify-between">
                      <span>Slug</span>
                      <span className="text-[var(--foreground)] font-mono">{task.slug}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>ID</span>
                    <span className="text-[var(--foreground)] font-mono">{task.id.slice(0, 8)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <NodeInspector
            graph={graph}

            onShowLogs={handleShowLogs}
          />

          <GraphVersionHistory graph={graph} />
          </aside>
        ) : null}
      </div>
      
      {/* Comparison modal */}
      <GraphComparisonModal graph={graph} />
      
      {/* Logs modal */}
      {showLogs && logsNodeId && (
        <LogsModal
          taskId={task.id}
          nodeId={logsNodeId}
          onClose={() => setShowLogs(false)}
        />
      )}
      
      {/* Node detail panel */}
      <NodeDetailPanel
        graph={graph}
        taskId={task.id}
        projectId={task.project_id}
        isOpen={showDetailPanel && !!selectedNodeId}
        onClose={handleCloseDetailPanel}
        onNodeTrigger={handleNodeTrigger}
        onShowLogs={handleShowLogs}
        onRefetch={onRefetch}
      />
    </div>
  );
}

// ── Logs Modal ───────────────────────────────────────────────────────

function LogsModal({
  taskId,
  nodeId,
  onClose,
}: {
  taskId: string;
  nodeId: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let cancelled = false;
    
    async function fetchLogs() {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/tasks/${taskId}/logs?nodeId=${nodeId}&tail=500`);
        const data = await response.json().catch(() => ({}));
        
        if (!response.ok) {
          throw new Error(data?.error || "Failed to fetch logs");
        }
        
        if (!cancelled) {
          const logLines = (data?.logs || [])
            .map((l: { content: string; log_type?: string }) => {
              const type = (l.log_type || "output").toLowerCase();
              if (type === "output") return l.content || "";
              return `[${type}] ${l.content || ""}`;
            })
            .join("\n");
          setLogs(logLines);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch logs");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    
    fetchLogs();
    return () => { cancelled = true; };
  }, [taskId, nodeId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content logs-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="logs-modal__header">
          <h3>Node Logs</h3>
          <button onClick={onClose} className="btn-ghost">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="logs-modal__body">
          {loading ? (
            <div className="logs-modal__loading">
              <span className="spinner" />
              Loading logs...
            </div>
          ) : error ? (
            <div className="logs-modal__error">{error}</div>
          ) : logs ? (
            <pre className="logs-modal__content">{logs}</pre>
          ) : (
            <div className="logs-modal__empty">No logs available for this node.</div>
          )}
        </div>
      </div>
    </div>
  );
}

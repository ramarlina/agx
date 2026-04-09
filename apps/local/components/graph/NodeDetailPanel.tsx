"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as Diff from "diff";

import { useGraphUIStore, resolveNodeActionInGraph, type NodeAction } from "@/components/graph/useGraphUIStore";
import { formatNodeStatusLabel, getNodeLabel } from "@/components/graph/graph-derived";
import { sanitizeTaskObjective } from "@/src/graph/objective";
import type {
  ExecutionGraph,
  GraphNode,
  WorkNode,
  RootNode,
  GateNode,
  NodeComment,
  NodeStatusEvent,
  RuntimeEvent,
  NodeStatus,
} from "@/src/graph/types";

interface NodeDetailPanelProps {
  graph: ExecutionGraph;
  taskId: string;
  projectId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onNodeTrigger?: (nodeId: string, action: NodeAction) => Promise<void>;
  onShowLogs?: (nodeId: string) => void;
  onRefetch?: () => Promise<void>;
}

interface NodeRun {
  id: string;
  timestamp: string;
  fromStatus: NodeStatus;
  toStatus: NodeStatus;
  output?: Record<string, unknown>;
  duration?: number;
}

// Tab types
type TabId = "execution" | "history" | "diff";

// Panel default and min/max width
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 800;

function formatTimestamp(value?: string): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "N/A";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "N/A";
  
  const diffMs = end - start;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getActionButtonLabel(action: NodeAction, status: NodeStatus): string | null {
  switch (action) {
    case 'start': return 'Start Node';
    case 'resume': return 'Resume Node';
    case 'retry': return (status === 'stopped' || status === 'done') ? 'Re-run Node' : 'Retry Node';
    default: return null;
  }
}

// Extract run history from runtime events for a specific node
function extractNodeRuns(graph: ExecutionGraph, nodeId: string): NodeRun[] {
  const events = graph.runtimeEvents ?? [];
  const nodeEvents: NodeRun[] = [];
  
  // Filter for node status events for this node
  const statusEvents = events.filter(
    (event): event is NodeStatusEvent => 
      event.eventType === "node_status" && event.nodeId === nodeId
  );
  
  // Group events into "runs" (status transitions that form a complete execution cycle)
  for (let i = 0; i < statusEvents.length; i++) {
    const event = statusEvents[i];
    const node = graph.nodes[nodeId];
    
    nodeEvents.push({
      id: `${event.nodeId}-${event.timestamp}`,
      timestamp: event.timestamp,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      output: node?.type === "work" ? (node as WorkNode).output : undefined,
      duration: undefined, // Would need to calculate from subsequent events
    });
  }
  
  return nodeEvents.reverse(); // Most recent first
}

// Render diff output
function DiffView({ diffA, diffB }: { diffA: string; diffB: string }) {
  const changes = useMemo(() => Diff.diffLines(diffA, diffB), [diffA, diffB]);
  
  if (!diffA && !diffB) {
    return <p className="text-xs text-[var(--muted-foreground)]">No output to compare.</p>;
  }
  
  return (
    <div className="node-detail-panel__diff">
      {changes.map((part: Diff.Change, index: number) => {
        const className = part.added 
          ? "node-detail-panel__diff-added" 
          : part.removed 
            ? "node-detail-panel__diff-removed" 
            : "node-detail-panel__diff-unchanged";
        
        return (
          <pre key={index} className={className}>
            {part.value}
          </pre>
        );
      })}
    </div>
  );
}

export default function NodeDetailPanel({
  graph,
  taskId,
  projectId,
  isOpen,
  onClose,
  onNodeTrigger,
  onShowLogs,
  onRefetch,
}: NodeDetailPanelProps) {
  const selectedNodeId = useGraphUIStore((state) => state.selectedNodeId);
  const triggeringNodeId = useGraphUIStore((state) => state.triggeringNodeId);
  
  const [activeTab, setActiveTab] = useState<TabId>("execution");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [diffRunA, setDiffRunA] = useState<string | null>(null);
  const [diffRunB, setDiffRunB] = useState<string | null>(null);
  
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  
  // Get node data
  const node = selectedNodeId ? graph.nodes[selectedNodeId] : null;
  const nodeRuns = useMemo(
    () => selectedNodeId ? extractNodeRuns(graph, selectedNodeId) : [],
    [graph, selectedNodeId]
  );
  
  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);
  
  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);
  
  // Reset diff selection when node changes
  useEffect(() => {
    setDiffRunA(null);
    setDiffRunB(null);
  }, [selectedNodeId]);
  
  // Handle node action trigger
  const handleTrigger = async () => {
    if (!selectedNodeId || !node || !onNodeTrigger) return;
    const action = resolveNodeActionInGraph(selectedNodeId, graph);
    const effectiveAction = action === 'blocked' ? 'start' : action;
    if (effectiveAction !== 'none') {
      await onNodeTrigger(selectedNodeId, effectiveAction);
    }
  };

  const handleStop = async () => {
    if (!selectedNodeId || !onNodeTrigger) return;
    await onNodeTrigger(selectedNodeId, "stop");
  };
  
  if (!isOpen || !selectedNodeId || !node) {
    return null;
  }
  
  const action = resolveNodeActionInGraph(selectedNodeId, graph);
  const effectiveAction = action === 'blocked' ? 'start' : action;
  const actionLabel = action === 'blocked' ? 'Run Node' : getActionButtonLabel(effectiveAction, node.status);
  const isTriggering = triggeringNodeId === selectedNodeId;
  const canStopNode = node.type === "work" && node.status === "running";
  
  // Get outputs for diff
  const getRunOutput = (runId: string | null): string => {
    if (!runId) return "";
    const run = nodeRuns.find(r => r.id === runId);
    if (!run?.output) return "";
    return JSON.stringify(run.output, null, 2);
  };
  
  // Current node output
  const currentOutput = node.type === "work" 
    ? JSON.stringify((node as WorkNode).output ?? {}, null, 2) 
    : "";
  
  return (
    <aside
      ref={panelRef}
      className={`node-detail-panel ${isOpen ? "node-detail-panel--open" : ""}`}
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        ref={resizeHandleRef}
        className={`node-detail-panel__resize-handle ${isResizing ? "node-detail-panel__resize-handle--active" : ""}`}
        onMouseDown={handleMouseDown}
      />
      
      {/* Header */}
      <header className="node-detail-panel__header">
        <div className="node-detail-panel__title-row">
          <div className="node-detail-panel__title">
            <h2>{getNodeLabel(selectedNodeId, node)}</h2>
            <div className="node-detail-panel__badges">
              <span className="node-detail-panel__type-badge">{node.type}</span>
              <span className={`node-detail-panel__status-badge node-detail-panel__status-badge--${node.status}`}>
                {formatNodeStatusLabel(node.status)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="node-detail-panel__close"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Tabs */}
        <nav className="node-detail-panel__tabs">
          <button
            type="button"
            className={`node-detail-panel__tab ${activeTab === "execution" ? "node-detail-panel__tab--active" : ""}`}
            onClick={() => setActiveTab("execution")}
          >
            Execution
          </button>
          <button
            type="button"
            className={`node-detail-panel__tab ${activeTab === "history" ? "node-detail-panel__tab--active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
            {nodeRuns.length > 0 && (
              <span className="node-detail-panel__tab-count">{nodeRuns.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`node-detail-panel__tab ${activeTab === "diff" ? "node-detail-panel__tab--active" : ""}`}
            onClick={() => setActiveTab("diff")}
          >
            Diff
          </button>
        </nav>
      </header>
      
      {/* Content */}
      <div className="node-detail-panel__content">
        {/* Execution Tab */}
        {activeTab === "execution" && (
          <div className="node-detail-panel__section">
            {/* Timing & Status */}
            <div className="node-detail-panel__grid">
              <span>Node ID</span>
              <code className="node-detail-panel__code">{selectedNodeId}</code>
              
              <span>Status</span>
              <strong className={`node-detail-panel__status--${node.status}`}>
                {formatNodeStatusLabel(node.status)}
              </strong>
              
              <span>Dependencies</span>
              <strong>{node.deps.length}</strong>
              
              <span>Started</span>
              <strong>{formatTimestamp(node.startedAt)}</strong>
              
              <span>Completed</span>
              <strong>{formatTimestamp(node.completedAt)}</strong>
              
              {node.startedAt && node.completedAt && (
                <>
                  <span>Duration</span>
                  <strong>{formatDuration(node.startedAt, node.completedAt)}</strong>
                </>
              )}
            </div>
            
            {/* Node type specific content */}
            {node.type === "root" && (
              <RootNodeDetails
                node={node as RootNode}
                nodeId={selectedNodeId}
                taskId={taskId}
                projectId={projectId}
                graphVersion={graph.graphVersion}
                onRefetch={onRefetch}
              />
            )}
            
            {node.type === "work" && (
              <WorkNodeDetails 
                node={node as WorkNode} 
                nodeId={selectedNodeId}
                onShowLogs={onShowLogs}
              />
            )}
            
            {node.type === "gate" && (
              <GateNodeDetails
                node={node as GateNode}
                nodeId={selectedNodeId}
                onNodeTrigger={onNodeTrigger}
                isTriggering={isTriggering}
              />
            )}
            
            {/* Comments */}
            <NodeComments
              taskId={taskId}
              nodeId={selectedNodeId}
              comments={node.comments ?? []}
              onRefetch={onRefetch}
            />

            {/* Action button */}
            {onNodeTrigger && (actionLabel || canStopNode) && (
              <div className="node-detail-panel__actions">
                {actionLabel && (
                  <button
                    type="button"
                    onClick={handleTrigger}
                    disabled={isTriggering}
                    className="btn btn-primary w-full"
                  >
                    {isTriggering ? (
                      <>
                        <span className="spinner w-4 h-4" />
                        Processing...
                      </>
                    ) : (
                      actionLabel
                    )}
                  </button>
                )}
                {canStopNode && (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={isTriggering}
                    className="btn btn-destructive w-full mt-2"
                  >
                    {isTriggering ? "Processing..." : "Stop Node"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* History Tab */}
        {activeTab === "history" && (
          <div className="node-detail-panel__section">
            {nodeRuns.length === 0 ? (
              <p className="node-detail-panel__empty">No run history available for this node.</p>
            ) : (
              <ul className="node-detail-panel__history-list">
                {nodeRuns.map((run) => (
                  <li 
                    key={run.id} 
                    className="node-detail-panel__history-item"
                  >
                    <div className="node-detail-panel__history-header">
                      <span className="node-detail-panel__history-time">
                        {formatTimestamp(run.timestamp)}
                      </span>
                      <span className={`node-detail-panel__history-status node-detail-panel__history-status--${run.toStatus}`}>
                        {formatNodeStatusLabel(run.toStatus)}
                      </span>
                    </div>
                    <div className="node-detail-panel__history-transition">
                      {formatNodeStatusLabel(run.fromStatus)} → {formatNodeStatusLabel(run.toStatus)}
                    </div>
                    {run.output && Object.keys(run.output).length > 0 && (
                      <details className="node-detail-panel__history-output">
                        <summary>Output</summary>
                        <pre>{JSON.stringify(run.output, null, 2)}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        
        {/* Diff Tab */}
        {activeTab === "diff" && (
          <div className="node-detail-panel__section">
            <div className="node-detail-panel__diff-controls">
              <div className="node-detail-panel__diff-select">
                <label>Run A:</label>
                <select 
                  value={diffRunA ?? ""} 
                  onChange={(e) => setDiffRunA(e.target.value || null)}
                  className="input"
                >
                  <option value="">Select a run...</option>
                  <option value="__current__">Current output</option>
                  {nodeRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {formatTimestamp(run.timestamp)} - {formatNodeStatusLabel(run.toStatus)}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="node-detail-panel__diff-select">
                <label>Run B:</label>
                <select 
                  value={diffRunB ?? ""} 
                  onChange={(e) => setDiffRunB(e.target.value || null)}
                  className="input"
                >
                  <option value="">Select a run...</option>
                  <option value="__current__">Current output</option>
                  {nodeRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {formatTimestamp(run.timestamp)} - {formatNodeStatusLabel(run.toStatus)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {diffRunA && diffRunB ? (
              <DiffView 
                diffA={diffRunA === "__current__" ? currentOutput : getRunOutput(diffRunA)}
                diffB={diffRunB === "__current__" ? currentOutput : getRunOutput(diffRunB)}
              />
            ) : (
              <p className="node-detail-panel__empty">
                Select two runs above to see the diff of their outputs.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Node Type Specific Components ────────────────────────────────────

function RootNodeDetails({
  node,
  nodeId,
  taskId,
  projectId,
  graphVersion,
  onRefetch,
}: {
  node: RootNode;
  nodeId: string;
  taskId: string;
  projectId?: string | null;
  graphVersion: number;
  onRefetch?: () => Promise<void>;
}) {
  const objective = sanitizeTaskObjective(node.objective, node.title);
  const [isEditingObjective, setIsEditingObjective] = useState(false);
  const [draftObjective, setDraftObjective] = useState(objective);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditingObjective) {
      setDraftObjective(objective);
      setSaveError(null);
    }
  }, [objective, isEditingObjective]);

  const handleSaveObjective = useCallback(async () => {
    const normalizedObjective = sanitizeTaskObjective(draftObjective, node.title);
    if (normalizedObjective === objective) {
      setIsEditingObjective(false);
      setSaveError(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/graph`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifMatchGraphVersion: graphVersion,
          projectId: projectId || undefined,
          nodeUpdates: {
            [nodeId]: {
              configPatch: {
                objective: normalizedObjective,
              },
            },
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update task objective");
      }
      await onRefetch?.();
      setIsEditingObjective(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update task objective");
    } finally {
      setIsSaving(false);
    }
  }, [draftObjective, node.title, objective, taskId, graphVersion, projectId, nodeId, onRefetch]);

  return (
    <div className="node-detail-panel__type-details">
      <h4>Task Objective</h4>
      {isEditingObjective ? (
        <div className="space-y-2">
          <textarea
            className="input w-full min-h-[90px] resize-y"
            value={draftObjective}
            onChange={(event) => setDraftObjective(event.target.value)}
            disabled={isSaving}
            aria-label="Edit task objective"
          />
          {saveError && (
            <p className="text-xs text-[var(--danger)]">{saveError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveObjective}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDraftObjective(objective);
                setSaveError(null);
                setIsEditingObjective(false);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="node-detail-panel__objective">{objective || "No objective defined."}</p>
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsEditingObjective(true)}
            >
              Edit Objective
            </button>
          </div>
        </>
      )}
      
      {node.criteria && node.criteria.length > 0 && (
        <div className="node-detail-panel__criteria">
          <h5>Success Criteria</h5>
          <ul>
            {node.criteria.map((criterion, index) => (
              <li key={index}>
                <span className="node-detail-panel__bullet">•</span>
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {node.planVersions && node.planVersions.length > 0 && (
        <div className="node-detail-panel__versions">
          <h5>Plan Versions</h5>
          <div className="flex flex-wrap gap-1">
            {node.planVersions.map((v) => (
              <span key={v} className="node-detail-panel__version-badge">v{v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlannedListSection({ title, items }: { title: string; items?: string[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="node-detail-panel__criteria mt-3">
      <h5>{title}</h5>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>
            <span className="node-detail-panel__bullet">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkNodeDetails({ 
  node, 
  nodeId,
  onShowLogs,
}: { 
  node: WorkNode; 
  nodeId: string;
  onShowLogs?: (nodeId: string) => void;
}) {
  const [expandedOutput, setExpandedOutput] = useState(false);
  
  return (
    <div className="node-detail-panel__type-details">
      <h4>Work Node</h4>
      {node.description && (
        <p className="node-detail-panel__description">{node.description}</p>
      )}
      
      <div className="node-detail-panel__grid mt-3">
        {node.workType && (
          <>
            <span>Work Type</span>
            <strong>{node.workType}</strong>
          </>
        )}
        <span>Attempts</span>
        <strong>{node.attempts} / {node.maxAttempts}</strong>
        
        <span>Retry Policy</span>
        <strong>{node.retryPolicy.onExhaust}</strong>
        
        {node.estimateMinutes !== undefined && (
          <>
            <span>Estimate</span>
            <strong>{node.estimateMinutes}m</strong>
          </>
        )}
        
        {node.actualMinutes !== undefined && (
          <>
            <span>Actual</span>
            <strong>{node.actualMinutes}m</strong>
          </>
        )}
      </div>

      <PlannedListSection title="Where" items={node.where} />
      <PlannedListSection title="What Changes" items={node.whatChanges} />
      <PlannedListSection title="Acceptance Criteria" items={node.acceptanceCriteria} />
      <PlannedListSection title="To Dos" items={node.todos} />
      <PlannedListSection title="Verification" items={node.verification} />
      
      {onShowLogs && node.startedAt && (
        <button
          type="button"
          onClick={() => onShowLogs(nodeId)}
          className="btn btn-secondary btn-sm mt-3 w-full"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          View Logs
        </button>
      )}
      
      {node.output && Object.keys(node.output).length > 0 && (
        <div className="node-detail-panel__output mt-3">
          <button
            type="button"
            onClick={() => setExpandedOutput(!expandedOutput)}
            className="node-detail-panel__output-toggle"
          >
            <span>Output</span>
            <svg
              className={`w-4 h-4 transition-transform ${expandedOutput ? "" : "-rotate-90"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedOutput && (
            <pre className="node-detail-panel__output-content">
              {JSON.stringify(node.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function GateNodeDetails({
  node,
  nodeId,
  onNodeTrigger,
  isTriggering,
}: {
  node: GateNode;
  nodeId: string;
  onNodeTrigger?: (nodeId: string, action: NodeAction) => Promise<void>;
  isTriggering: boolean;
}) {
  const isAwaitingHuman = node.status === "awaiting_human";

  return (
    <div className="node-detail-panel__type-details">
      <h4>Gate</h4>

      <div className="node-detail-panel__grid mt-2">
        <span>Gate Type</span>
        <strong>{node.gateType}</strong>

        <span>Required</span>
        <strong>{node.required ? "Yes" : "No"}</strong>

        <span>Strategy</span>
        <strong>{node.verificationStrategy.type}</strong>
      </div>

      {/* Approve / Reject actions for human gates */}
      {isAwaitingHuman && onNodeTrigger && (
        <div className="node-detail-panel__actions mt-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onNodeTrigger(nodeId, "approve")}
              disabled={isTriggering}
              className="btn btn-primary flex-1"
            >
              {isTriggering ? "Processing..." : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => onNodeTrigger(nodeId, "reject")}
              disabled={isTriggering}
              className="btn btn-destructive flex-1"
            >
              {isTriggering ? "Processing..." : "Reject"}
            </button>
          </div>
        </div>
      )}

      {node.verificationStrategy.checks && node.verificationStrategy.checks.length > 0 && (
        <div className="node-detail-panel__checks mt-3">
          <h5>Checks</h5>
          <ul>
            {node.verificationStrategy.checks.map((check, index) => {
              const result = node.verificationResult?.checks?.find(r => r.check === check);
              return (
                <li
                  key={index}
                  className={result ? (result.passed ? 'node-detail-panel__check--passed' : 'node-detail-panel__check--failed') : ''}
                >
                  <span className="node-detail-panel__check-icon">
                    {result ? (result.passed ? '✓' : '✗') : '○'}
                  </span>
                  <span>{check}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {node.verificationResult?.checks?.length ? (
        <div className="node-detail-panel__verification-results mt-3">
          <h5>Verification Results</h5>
          <ul>
            {node.verificationResult.checks.map((check, index) => (
              <li key={`${check.check}-${index}`}>
                <span className={check.passed ? "text-green-600" : "text-red-600"}>
                  {check.passed ? "PASS" : "FAIL"}
                </span>
                <span>{check.check}</span>
                {check.message && (
                  <span className="text-[var(--muted-foreground)]">{check.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Node Comments ────────────────────────────────────────────────────

function NodeComments({
  taskId,
  nodeId,
  comments,
  onRefetch,
}: {
  taskId: string;
  nodeId: string;
  comments: NodeComment[];
  onRefetch?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/nodes/${nodeId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to add comment");
      }
      setDraft("");
      await onRefetch?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, taskId, nodeId, onRefetch]);

  return (
    <div className="node-detail-panel__type-details">
      <h4>Comments</h4>

      {comments.length > 0 ? (
        <ul className="node-detail-panel__history-list">
          {comments.map((c) => (
            <li key={c.id} className="node-detail-panel__history-item">
              <div className="node-detail-panel__history-header">
                <span className="node-detail-panel__history-time">
                  {formatTimestamp(c.createdAt)}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">{c.author}</span>
              </div>
              <p className="text-sm mt-1">{c.content}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="node-detail-panel__empty">No comments yet.</p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          className="input flex-1"
          placeholder="Add a steering comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={isSubmitting}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={isSubmitting || !draft.trim()}
        >
          {isSubmitting ? "..." : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--danger)] mt-1">{error}</p>}
    </div>
  );
}

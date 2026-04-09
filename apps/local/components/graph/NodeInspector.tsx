"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { formatNodeStatusLabel, getNodeLabel } from "@/components/graph/graph-derived";
import { useGraphUIStore, resolveNodeActionInGraph, type NodeAction } from "@/components/graph/useGraphUIStore";
import { sanitizeTaskObjective } from "@/src/graph/objective";
import type { ExecutionGraph, RootNode, WorkNode, GateNode, NodeStatus } from "@/src/graph/types";

interface NodeInspectorProps {
  graph: ExecutionGraph;
  onNodeTrigger?: (nodeId: string, action: NodeAction) => Promise<void>;
  showLogsButton?: boolean;
  onShowLogs?: (nodeId: string) => void;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
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

const MIN_WIDTH = 280;
const MAX_WIDTH = 700;

export default function NodeInspector({
  graph,
  onNodeTrigger,
  showLogsButton = true,
  onShowLogs,
}: NodeInspectorProps) {
  const selectedNodeId = useGraphUIStore((state) => state.selectedNodeId);
  const triggeringNodeId = useGraphUIStore((state) => state.triggeringNodeId);
  const setSelectedNodeId = useGraphUIStore((state) => state.setSelectedNodeId);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      panelRef.current.style.width = `${clamped}px`;
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  if (!selectedNodeId || !graph.nodes[selectedNodeId]) {
    return (
      <aside ref={panelRef} className="graph-panel-card node-inspector node-inspector--resizable">
        <div className="node-inspector__resize-handle" onMouseDown={handleMouseDown} />
        <div className="graph-panel-card__title">Node Inspector</div>
        <p className="graph-panel-card__empty">Select a node in the graph to inspect details.</p>
      </aside>
    );
  }

  const node = graph.nodes[selectedNodeId];
  const action = resolveNodeActionInGraph(selectedNodeId, graph);
  // For blocked nodes, allow forcing a start
  const effectiveAction = action === 'blocked' ? 'start' : action;
  const actionLabel = action === 'blocked' ? 'Run Node' : getActionButtonLabel(effectiveAction, node.status);
  const isTriggering = triggeringNodeId === selectedNodeId;
  const canStopNode = node.type === "work" && node.status === "running";

  const handleTrigger = async () => {
    if (effectiveAction !== 'none' && onNodeTrigger) {
      await onNodeTrigger(selectedNodeId, effectiveAction);
    }
  };

  const handleStop = async () => {
    if (!onNodeTrigger) return;
    await onNodeTrigger(selectedNodeId, "stop");
  };

  return (
    <aside ref={panelRef} className="graph-panel-card node-inspector node-inspector--resizable">
      <div className="node-inspector__resize-handle" onMouseDown={handleMouseDown} />
      <div className="graph-panel-card__row">
        <div className="graph-panel-card__title">Node Inspector</div>
        <button
          type="button"
          className="graph-link-button"
          onClick={() => setSelectedNodeId(null)}
        >
          Clear
        </button>
      </div>

      <div className="node-inspector__headline">
        <div className="node-inspector__name">{getNodeLabel(selectedNodeId, node)}</div>
        <div className="node-inspector__badges">
          <span className="node-inspector__pill">{node.type}</span>
          {node.type === 'root' && (
            <span className="node-inspector__pill node-inspector__pill--root">root</span>
          )}
        </div>
      </div>

      <div className="node-inspector__grid">
        <span>Status</span>
        <strong className={`node-inspector__status node-inspector__status--${node.status}`}>
          {formatNodeStatusLabel(node.status)}
        </strong>

        <span>Node ID</span>
        <code>{selectedNodeId}</code>

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

      {/* Root node section */}
      {node.type === "root" && (
        <RootNodeSection node={node as RootNode} />
      )}

      {/* Work node section */}
      {node.type === "work" && (
        <WorkNodeSection 
          node={node as WorkNode} 
          showLogsButton={showLogsButton}
          onShowLogs={() => onShowLogs?.(selectedNodeId)}
        />
      )}

      {/* Gate node section */}
      {node.type === "gate" && (
        <GateNodeSection node={node as GateNode} />
      )}

      {node.type === "conditional" && (
        <div className="node-inspector__section">
          <h4>Condition</h4>
          <p>{node.condition.expression}</p>
        </div>
      )}

      {/* Action button */}
      {onNodeTrigger && (actionLabel || canStopNode) && (
        <div className="node-inspector__actions">
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
    </aside>
  );
}

// ── Root Node Section ────────────────────────────────────────────────

function RootNodeSection({ node }: { node: RootNode }) {
  const objective = sanitizeTaskObjective(node.objective, node.title);

  return (
    <div className="node-inspector__section">
      <h4>Task Objective</h4>
      <p className="node-inspector__objective">{objective || "No objective defined."}</p>
      
      {node.criteria && node.criteria.length > 0 && (
        <div className="node-inspector__criteria">
          <h5>Success Criteria</h5>
          <ul>
            {node.criteria.map((criterion, index) => (
              <li key={index}>
                <span className="node-inspector__criterion-bullet">•</span>
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {node.planVersions && node.planVersions.length > 0 && (
        <div className="node-inspector__versions">
          <h5>Plan Versions</h5>
          <div className="flex flex-wrap gap-1">
            {node.planVersions.map((v) => (
              <span key={v} className="node-inspector__version-badge">v{v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Work Node Section ────────────────────────────────────────────────

function WorkNodeSection({ 
  node, 
  showLogsButton,
  onShowLogs 
}: { 
  node: WorkNode; 
  showLogsButton: boolean;
  onShowLogs: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="node-inspector__section">
      <h4>Work Node</h4>
      <p>{node.description || "No description provided."}</p>
      
      <div className="node-inspector__grid">
        {node.workType && (
          <>
            <span>Work Type</span>
            <strong>{node.workType}</strong>
          </>
        )}
        <span>Attempts</span>
        <strong>
          {node.attempts} / {node.maxAttempts}
        </strong>
        
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

      {Array.isArray(node.where) && node.where.length > 0 && (
        <PlannedWorkList title="Where" items={node.where} />
      )}
      {Array.isArray(node.whatChanges) && node.whatChanges.length > 0 && (
        <PlannedWorkList title="What Changes" items={node.whatChanges} />
      )}
      {Array.isArray(node.acceptanceCriteria) && node.acceptanceCriteria.length > 0 && (
        <PlannedWorkList title="Acceptance Criteria" items={node.acceptanceCriteria} />
      )}
      {Array.isArray(node.todos) && node.todos.length > 0 && (
        <PlannedWorkList title="To Dos" items={node.todos} />
      )}
      {Array.isArray(node.verification) && node.verification.length > 0 && (
        <PlannedWorkList title="Verification" items={node.verification} />
      )}
      
      {showLogsButton && (
        <button
          type="button"
          onClick={onShowLogs}
          className="btn btn-secondary btn-sm mt-3 w-full"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          View Logs
        </button>
      )}
      
      {node.output && Object.keys(node.output).length > 0 && (
        <DecisionOutput data={parseOutputData(node.output)} expandedSections={expandedSections} toggle={toggle} />
      )}
    </div>
  );
}

function PlannedWorkList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="node-inspector__checks-list mt-3">
      <h5>{title}</h5>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>
            <span className="check-icon">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Gate Node Section ────────────────────────────────────────────────

function GateNodeSection({ node }: { node: GateNode }) {
  return (
    <div className="node-inspector__section">
      <h4>Gate</h4>
      <div className="node-inspector__grid">
        <span>Gate Type</span>
        <strong>{node.gateType}</strong>
        <span>Required</span>
        <strong>{node.required ? "Yes" : "No"}</strong>
        <span>Strategy</span>
        <strong>{node.verificationStrategy.type}</strong>
      </div>
      
      {node.verificationStrategy.checks && node.verificationStrategy.checks.length > 0 && (
        <div className="node-inspector__checks-list">
          <h5>Checks</h5>
          <ul>
            {node.verificationStrategy.checks.map((check, index) => {
              const result = node.verificationResult?.checks?.find(r => r.check === check);
              return (
                <li key={index} className={result ? (result.passed ? 'check--passed' : 'check--failed') : ''}>
                  <span className="check-icon">
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
        <ul className="node-inspector__checks">
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
      ) : null}
    </div>
  );
}

// ── Decision JSON renderer ───────────────────────────────────────────

/** If output has a single string value that looks like JSON, parse it into an object. */
function parseOutputData(data: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(data);
  // If the whole output is a single string that's valid JSON, parse it
  if (keys.length === 1 && typeof data[keys[0]] === "string") {
    try {
      const parsed = JSON.parse(data[keys[0]] as string);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* not JSON, keep as-is */ }
  }
  return data;
}

const DECISION_KNOWN_KEYS = ["done", "decision", "analysis", "explanation", "next_step", "question", "final_result", "summary", "plan_md", "implementation_summary_md", "verification_md", "next_prompt"] as const;

function isMarkdownField(key: string): boolean {
  return key.endsWith("_md");
}

function DecisionOutput({ 
  data, 
  expandedSections, 
  toggle 
}: { 
  data: Record<string, unknown>;
  expandedSections: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  // Separate known decision keys from extras
  const knownEntries: [string, unknown][] = [];
  const extraEntries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if ((DECISION_KNOWN_KEYS as readonly string[]).includes(key)) {
      knownEntries.push([key, value]);
    } else {
      extraEntries.push([key, value]);
    }
  }

  // Sort known keys in canonical order
  knownEntries.sort((a, b) => {
    const ai = (DECISION_KNOWN_KEYS as readonly string[]).indexOf(a[0]);
    const bi = (DECISION_KNOWN_KEYS as readonly string[]).indexOf(b[0]);
    return ai - bi;
  });

  const allEntries = [...knownEntries, ...extraEntries];

  return (
    <div className="mt-3 space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Output</h4>
      {allEntries.map(([key, value]) => (
        <DecisionField
          key={key}
          fieldKey={key}
          value={value}
          expanded={expandedSections[key] ?? false}
          onToggle={() => toggle(key)}
        />
      ))}
    </div>
  );
}

function DecisionField({
  fieldKey,
  value,
  expanded,
  onToggle,
}: {
  fieldKey: string;
  value: unknown;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = fieldKey.replace(/_/g, " ").replace(/\bmd\b/g, "").trim();

  // Boolean values (done)
  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-[var(--muted-foreground)] capitalize">{label}</span>
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${value ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {value ? "yes" : "no"}
        </span>
      </div>
    );
  }

  // Short strings (decision, next_prompt when empty)
  if (typeof value === "string" && value.length < 80 && !value.includes("\n")) {
    return (
      <div className="flex items-start justify-between gap-2 py-1">
        <span className="text-xs text-[var(--muted-foreground)] capitalize flex-shrink-0">{label}</span>
        <span className="text-xs font-medium text-right">{value || <em className="text-[var(--muted-foreground)]">empty</em>}</span>
      </div>
    );
  }

  // Long strings / markdown — collapsible
  if (typeof value === "string") {
    const isMd = isMarkdownField(fieldKey);
    const preview = value.slice(0, 120).replace(/\n/g, " ");

    return (
      <div className="border border-[var(--card-border)] rounded-md overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-[var(--muted)]/30 transition-colors"
        >
          <span className="text-xs text-[var(--muted-foreground)] capitalize">{label}</span>
          <svg
            className={`w-3 h-3 text-[var(--muted-foreground)] transition-transform ${expanded ? "" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expanded ? (
          <div className={`px-2.5 pb-2.5 text-xs leading-relaxed ${isMd ? "whitespace-pre-wrap" : ""}`}>
            {isMd ? (
              <MarkdownLite content={value} />
            ) : (
              <p className="whitespace-pre-wrap break-words">{value}</p>
            )}
          </div>
        ) : (
          <p className="px-2.5 pb-2 text-[11px] text-[var(--muted-foreground)] truncate">{preview}...</p>
        )}
      </div>
    );
  }

  // Objects / arrays — render as formatted JSON
  if (typeof value === "object" && value !== null) {
    const json = JSON.stringify(value, null, 2);
    return (
      <div className="border border-[var(--card-border)] rounded-md overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-[var(--muted)]/30 transition-colors"
        >
          <span className="text-xs text-[var(--muted-foreground)] capitalize">{label}</span>
          <svg
            className={`w-3 h-3 text-[var(--muted-foreground)] transition-transform ${expanded ? "" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expanded && (
          <pre className="px-2.5 pb-2.5 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words">{json}</pre>
        )}
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[var(--muted-foreground)] capitalize">{label}</span>
      <span className="text-xs font-mono">{String(value)}</span>
    </div>
  );
}

/** Minimal markdown: renders checklist lines, headings, and plain text. */
function MarkdownLite({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trimStart();
        // Checklist: - [x] or - [ ]
        const checkMatch = trimmed.match(/^-\s*\[(x| )\]\s*(.*)$/i);
        if (checkMatch) {
          const checked = checkMatch[1].toLowerCase() === "x";
          return (
            <div key={i} className="flex items-start gap-1.5">
              <span className={`flex-shrink-0 mt-0.5 ${checked ? "text-green-600" : "text-[var(--muted-foreground)]"}`}>
                {checked ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                  </svg>
                )}
              </span>
              <span className={checked ? "line-through text-[var(--muted-foreground)]" : ""}>{checkMatch[2]}</span>
            </div>
          );
        }
        // Bullet: - item
        if (trimmed.startsWith("- ")) {
          return <div key={i} className="flex items-start gap-1.5"><span className="flex-shrink-0 mt-1 w-1 h-1 rounded-full bg-current opacity-40" /><span>{trimmed.slice(2)}</span></div>;
        }
        // Empty line
        if (!trimmed) return <div key={i} className="h-1" />;
        // Default
        return <div key={i}>{line}</div>;
      })}
    </div>
  );
}

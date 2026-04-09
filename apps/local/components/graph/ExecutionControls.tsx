"use client";

import { useState } from "react";
import type { ExecutionGraph, ExecutionLifecycleState } from "@/src/graph/types";

interface ExecutionControlsProps {
  graph: ExecutionGraph;
  taskId: string;
  onStateChange?: (newState: ExecutionLifecycleState) => void;
  onRefetch?: () => Promise<void>;
}

type ActionType = 'start' | 'pause' | 'stop' | 'resume' | 'restart';

interface ActionConfig {
  label: string;
  icon: React.ReactNode;
  className: string;
  action: ActionType;
}

function deriveExecutionState(g: ExecutionGraph): ExecutionLifecycleState {
  const nodes = Object.values(g.nodes);
  if (nodes.length === 0) return 'ready';
  
  const hasRunning = nodes.some(n => n.status === 'running' || n.status === 'awaiting_human');
  if (hasRunning) return 'running';
  
  const hasPaused = nodes.some(n => n.status === 'paused');
  if (hasPaused) return 'paused';
  
  const hasStopped = nodes.some(n => n.status === 'stopped');
  if (hasStopped) return 'stopped';
  
  const allTerminal = nodes.every(n => 
    n.status === 'done' || n.status === 'passed' || n.status === 'failed' || n.status === 'skipped'
  );
  if (allTerminal) return 'done';
  
  return 'ready';
}

function getAvailableActions(state: ExecutionLifecycleState): ActionConfig[] {
  switch (state) {
    case 'ready':
      return [{
        label: 'Start',
        icon: <PlayIcon />,
        className: 'btn-primary',
        action: 'start',
      }];
      
    case 'running':
      return [
        {
          label: 'Pause',
          icon: <PauseIcon />,
          className: 'btn-secondary',
          action: 'pause',
        },
        {
          label: 'Stop',
          icon: <StopIcon />,
          className: 'btn-ghost text-[var(--destructive)]',
          action: 'stop',
        },
      ];
      
    case 'paused':
      return [
        {
          label: 'Resume',
          icon: <PlayIcon />,
          className: 'btn-primary',
          action: 'resume',
        },
        {
          label: 'Stop',
          icon: <StopIcon />,
          className: 'btn-ghost text-[var(--destructive)]',
          action: 'stop',
        },
      ];
      
    case 'stopped':
      return [{
        label: 'Resume',
        icon: <PlayIcon />,
        className: 'btn-primary',
        action: 'resume',
      }];
      
    case 'done':
      return [{
        label: 'Restart',
        icon: <RestartIcon />,
        className: 'btn-secondary',
        action: 'restart',
      }];
      
    default:
      return [];
  }
}

function getStateLabel(state: ExecutionLifecycleState): string {
  switch (state) {
    case 'ready': return 'Ready';
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'stopped': return 'Stopped';
    case 'done': return 'Complete';
    default: return state;
  }
}

function getStateColor(state: ExecutionLifecycleState): string {
  switch (state) {
    case 'ready': return 'bg-[var(--muted)] text-[var(--muted-foreground)]';
    case 'running': return 'bg-[var(--status-in-progress-bg)] text-[var(--status-in-progress)]';
    case 'paused': return 'bg-amber-100 text-amber-700';
    case 'stopped': return 'bg-[var(--status-blocked-bg)] text-[var(--status-blocked)]';
    case 'done': return 'bg-[var(--status-completed-bg)] text-[var(--status-completed)]';
    default: return 'bg-[var(--muted)] text-[var(--muted-foreground)]';
  }
}

export default function ExecutionControls({
  graph,
  taskId,
  onStateChange,
  onRefetch,
}: ExecutionControlsProps) {
  const [isLoading, setIsLoading] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Default to 'ready' if execution state not set, or derive from graph
  const executionState: ExecutionLifecycleState = graph.executionState ?? deriveExecutionState(graph);
  const actions = getAvailableActions(executionState);
  
  const handleAction = async (action: ActionType) => {
    setIsLoading(action);
    setError(null);
    
    try {
      const endpoint = `/api/tasks/${taskId}/graph/${action}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        throw new Error(data?.error || `Failed to ${action} execution`);
      }
      
      // Notify parent of state change
      if (data?.executionState) {
        onStateChange?.(data.executionState);
      }
      
      // Refetch graph data
      await onRefetch?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setIsLoading(null);
    }
  };
  
  return (
    <div className="execution-controls">
      <div className="execution-controls__status">
        <span className={`execution-controls__badge ${getStateColor(executionState)}`}>
          {executionState === 'running' && <span className="execution-controls__pulse" />}
          {getStateLabel(executionState)}
        </span>
        
        <span className="execution-controls__version">
          v{graph.graphVersion}
        </span>
      </div>
      
      <div className="execution-controls__actions">
        {actions.map(({ label, icon, className, action }) => (
          <button
            key={action}
            type="button"
            onClick={() => handleAction(action)}
            disabled={isLoading !== null}
            className={`btn ${className} execution-controls__btn`}
          >
            {isLoading === action ? (
              <span className="spinner w-4 h-4" />
            ) : (
              icon
            )}
            <span>{label}</span>
          </button>
        ))}
      </div>
      
      {error && (
        <div className="execution-controls__error">
          {error}
        </div>
      )}
    </div>
  );
}

// Icons
function PlayIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

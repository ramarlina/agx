"use client";

import { Task } from "./TaskCard";
import { useEffect, useState, useMemo } from "react";
import { UI_POLL_TASK_DURATION_MS } from "@/lib/constants/timing";
import type { AgentProcessEntry } from "@/lib/agent-process-registry";
import FloatingPanel from "@/components/FloatingPanel";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";

const MAX_WORKERS = Number(process.env.NEXT_PUBLIC_AGX_MAX_WORKERS) || 10;

interface NowRunningPanelProps {
  tasks: Task[];
  processes?: AgentProcessEntry[];
  onTaskClick?: (task: Task) => void;
  onStop?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  cancellingTaskId?: string | null;
  panelId?: string;
}

export default function NowRunningPanel({
  tasks,
  processes = [],
  onTaskClick,
  onStop,
  onRetry,
  cancellingTaskId,
  panelId = "now-running-panel",
}: NowRunningPanelProps) {
  const { isTouchLayout } = useInputCapabilities();
  // Active processes (spawning or running)
  const activeProcesses = useMemo(
    () => processes.filter((p) => p.state === "spawning" || p.state === "running"),
    [processes]
  );
  const runningTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress"), [tasks]);
  const [times, setTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    // Update times every minute
    const updateTimes = () => {
      const newTimes: Record<string, string> = {};
      runningTasks.forEach(task => {
        // Use updated_at as proxy for "started running at" or "last active"
        // Ideally we'd have a 'started_at' field
        const startTime = new Date(task.updated_at).getTime();
        const now = Date.now();
        const diffMinutes = Math.floor((now - startTime) / 60000);
        
        if (diffMinutes < 1) newTimes[task.id] = "< 1m";
        else if (diffMinutes < 60) newTimes[task.id] = `${diffMinutes}m`;
        else newTimes[task.id] = `${Math.floor(diffMinutes / 60)}h`;
      });
      setTimes(newTimes);
    };

    updateTimes();
    const interval = setInterval(updateTimes, UI_POLL_TASK_DURATION_MS);
    return () => clearInterval(interval);
  }, [runningTasks]); // Re-run when tasks change

  const workerUtilization = runningTasks.length / MAX_WORKERS;
  const isWarning = workerUtilization >= 0.8;
  const isCritical = runningTasks.length >= MAX_WORKERS;

  if (runningTasks.length === 0) return null;

  return (
    <FloatingPanel
      panelId={panelId}
      defaultBounds={{ x: 24, y: 120, width: 720, height: 248 }}
      minWidth={420}
      minHeight={180}
      className="animate-fade-in-down"
      bodyClassName="flex-1 overflow-auto"
      titleBar={(
        <div className="flex items-center gap-4 p-3 sm:p-4 flex-wrap sm:flex-nowrap sm:min-w-max">
          <div className="flex flex-col justify-center pr-4 border-r border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--foreground)] whitespace-nowrap flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Now Running
            </h3>
            <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider font-semibold">
              {runningTasks.length} Active{activeProcesses.length > 0 ? ` · ${activeProcesses.length} process${activeProcesses.length > 1 ? "es" : ""}` : ""}
            </span>
          </div>

          {/* Worker Utilization Indicator */}
          <div className="hidden sm:flex flex-col justify-center pr-4 border-r border-[var(--border)] gap-1" title={`${runningTasks.length} of ${MAX_WORKERS} max workers in use. Single-writer SQLite architecture — see docs/LIMITS.md`}>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${isCritical ? "text-red-400" : isWarning ? "text-amber-400" : "text-[var(--muted-foreground)]"}`}>
                {runningTasks.length}/{MAX_WORKERS} workers
              </span>
              {isWarning && (
                <svg className={`w-3 h-3 ${isCritical ? "text-red-400" : "text-amber-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
            </div>
            <div className="w-16 h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isCritical ? "bg-red-400" : isWarning ? "bg-amber-400" : "bg-[var(--primary)]"}`}
                style={{ width: `${Math.min(workerUtilization * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}
    >
      <div className="max-w-full overflow-x-auto no-scrollbar p-3 sm:p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {runningTasks.map((task) => {
            const isStopping = task.id === cancellingTaskId;
            return (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                className="group flex items-center gap-3 pl-3 pr-2 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg hover:border-[var(--primary)] transition-all cursor-pointer shadow-sm hover:shadow-md min-w-0 w-full sm:min-w-[280px] sm:w-auto"
              >
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[var(--muted)] flex items-center justify-center text-[10px] sm:text-xs font-bold border border-[var(--border)] shrink-0">
                  {task.provider ? task.provider.substring(0, 2).toUpperCase() : "AG"}
                </div>

                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-semibold text-[var(--foreground)] truncate max-w-[120px]">
                      {task.provider || "Agent"} {task.model ? `• ${task.model}` : ""}
                    </span>
                    <span className="font-mono text-[var(--muted-foreground)]">
                      {times[task.id] || "0m"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--muted-foreground)] truncate max-w-[140px]">
                      {task.title || task.content.substring(0, 30)}
                    </span>
                    <div className="w-12 h-1 bg-[var(--muted)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--primary)] animate-pulse rounded-full"
                        style={{ width: `${Math.random() * 40 + 30}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className={`flex items-center gap-1 pl-2 border-l border-[var(--border)] transition-opacity ${isTouchLayout ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isStopping) return;
                      onStop?.(task.id);
                    }}
                    disabled={isStopping}
                    className={`p-1 rounded transition-all ${isStopping ? "cursor-wait text-[var(--destructive)]/80 opacity-80" : "hover:bg-[var(--destructive)]/10 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"}`}
                    title={isStopping ? "Stopping..." : "Stop Task"}
                    data-no-panel-drag="true"
                  >
                    {isStopping ? (
                      <span className="inline-flex h-3 w-3 rounded-full border border-[var(--destructive)] border-t-transparent animate-spin" />
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry?.(task.id);
                    }}
                    className="p-1 hover:bg-[var(--primary)]/10 text-[var(--muted-foreground)] hover:text-[var(--primary)] rounded"
                    title="Retry / Restart"
                    data-no-panel-drag="true"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 21h5v-5" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FloatingPanel>
  );
}

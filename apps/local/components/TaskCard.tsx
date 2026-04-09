"use client";

import { ProjectContext } from "@/types/project-context";
import StatusCircle from "./StatusCircle";
import { formatNodeStatusLabel } from "@/components/graph/graph-derived";
import { useTaskGraphSummary } from "@/hooks/useTaskGraphSummary";

export type TaskStatus = "queued" | "in_progress" | "blocked" | "completed" | "failed";
export type TaskStage = "INTAKE" | "PROGRESS" | "DONE" | (string & {});

export interface Task {
  id: string;
  user_id?: string;
  content: string;
  description?: string;
  title?: string;
  status?: TaskStatus;
  stage?: TaskStage;
  depends_on?: string[];
  blocked_reason?: string | null;
  project?: string | null;
  project_id?: string | null;
  project_context?: ProjectContext | null;
  priority?: number;
  engine?: string;
  provider?: string;
  model?: string;
  swarm?: boolean;
  approval_mode?: "auto" | "manual";
  swarm_models?: Array<{ provider: string; model: string }>;
  slug?: string;
  error?: string;
  started_at?: string | null;
  completed_at?: string | null;
  stage_decisions?: Record<string, { decision: string; rationale: string; final_result: string; decided_at: string }>;
  workflow_id?: string | null;
  workflow_run_id?: string | null;
  orchestration_status?: string | null;
  last_orchestration_update?: string | null;
  created_at: string;
  updated_at: string;
  pid?: number | null;
  exit_code?: number | null;
  history?: TaskRunHistory[];

  // Server-resolved defaults (do not imply an explicit override on the task).
  resolved_provider?: string;
  resolved_model?: string;
  resolved_swarm?: boolean;
  resolved_swarm_models?: Array<{ provider: string; model: string }>;
}

export interface TaskRunHistory {
  id: string;
  task_id: string;
  pid?: number;
  exit_code?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  created_at: string;
}

const statusConfig: Record<TaskStatus, { className: string; label: string; dotColor: string }> = {
  queued: {
    className: "badge-status-queued",
    label: "Queued",
    dotColor: "bg-[var(--status-queued)]"
  },
  in_progress: {
    className: "badge-status-in_progress",
    label: "In Progress",
    dotColor: "bg-[var(--status-in-progress)]"
  },
  blocked: {
    className: "badge-status-blocked",
    label: "Blocked",
    dotColor: "bg-[var(--status-blocked)]"
  },
  completed: {
    className: "badge-status-completed",
    label: "Completed",
    dotColor: "bg-[var(--status-completed)]"
  },
  failed: {
    className: "badge-status-failed",
    label: "Failed",
    dotColor: "bg-[var(--status-failed)]"
  },
};

const stageConfig: Record<string, { icon: string; label: string }> = {
  INTAKE: { icon: "📥", label: "Intake" },
  PROGRESS: { icon: "🔄", label: "Progress" },
  DONE: { icon: "✅", label: "Done" },
};

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  compact?: boolean;
  onStatusChange?: (status: TaskStatus) => void;
  onApprovalModeChange?: (mode: "auto" | "manual") => void;
  /** All tasks in the board, used to resolve dependency status */
  allTasks?: Task[];
  relationship?: 'active' | 'blocking' | 'dependent' | 'dimmed' | 'none';
}

export default function TaskCard({ task, onClick, compact = false, onStatusChange, onApprovalModeChange, allTasks, relationship = 'none' }: TaskCardProps) {
  const status = statusConfig[task.status || "queued"];
  const stage = task.stage ? stageConfig[task.stage] : null;
  const { summary, isLoading: isGraphSummaryLoading } = useTaskGraphSummary(task.id !== "draft" ? task.id : null);

  // Resolve dependency status
  const deps = task.depends_on?.length ? task.depends_on.map((depId) => {
    const depTask = allTasks?.find((t) => t.id === depId);
    return {
      id: depId,
      title: depTask?.title || depId.slice(0, 8),
      done: depTask?.status === "completed",
    };
  }) : null;

  const allDepsMet = deps ? deps.every((d) => d.done) : true;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={`group relative flex flex-col gap-1.5 sm:gap-2 p-2 sm:p-3 surface-card cursor-grab active:cursor-grabbing
        focus-visible:outline-2 focus-visible:outline-[var(--ring)] focus-visible:outline-offset-2
        ${relationship === 'active' ? 'border-primary ring-2 ring-primary/20 z-40' :
          relationship === 'blocking' ? 'border-[var(--status-blocked)] bg-rose-50/30 dark:bg-rose-950/20 z-20' :
            relationship === 'dependent' ? 'border-[var(--status-in-progress)] bg-blue-50/30 dark:bg-blue-950/20 z-20' :
              relationship === 'dimmed' ? 'opacity-40 grayscale scale-[0.98]' :
                ''
        }
        ${task.status === 'failed' && relationship === 'none' ? 'border-red-200 bg-red-50/30 dark:bg-red-950/20' : ''}
        ${task.status === 'completed' && relationship === 'none' ? 'opacity-75 bg-[var(--secondary)]' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className={`text-sm font-medium text-[var(--foreground)] leading-snug line-clamp-2 sm:line-clamp-3
          ${task.status === 'completed' ? 'text-[var(--muted-foreground)] line-through' : ''}
        `}>
          {task.title || "Untitled Task"}
        </h3>

        {/* Status Circle - aligned top right */}
        <div className="shrink-0 mt-0.5">
          <StatusCircle
            status={task.status || "queued"}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>

      {/* Footer / Metadata */}
      <div className="flex items-center justify-between min-h-[16px]">
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)] flex-wrap">
          {task.priority !== undefined && task.priority > 0 && (
            <span className={`px-1.5 py-0.5 rounded font-semibold bg-[var(--secondary)] ${task.priority === 0 ? 'text-[var(--primary)]' : ''}`}>
              P{task.priority}
            </span>
          )}
          {onApprovalModeChange && (
            task.approval_mode === "auto" ? (
              <span
                className="px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 cursor-pointer select-none"
                title="Auto-approve enabled. Click to switch to manual."
                onClick={(e) => {
                  e.stopPropagation();
                  onApprovalModeChange("manual");
                }}
              >
                AUTO
              </span>
            ) : (
              <span
                className="px-1.5 py-0.5 rounded font-semibold bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-pointer select-none opacity-0 group-hover:opacity-100 transition-opacity"
                title="Manual approval. Click to enable auto-approve."
                onClick={(e) => {
                  e.stopPropagation();
                  onApprovalModeChange("auto");
                }}
              >
                AUTO
              </span>
            )
          )}
          {task.id !== 'draft' && (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[9px]">
              {task.id.slice(0, 5)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

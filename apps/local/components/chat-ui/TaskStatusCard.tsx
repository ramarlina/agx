"use client";

import { useState, useCallback } from "react";
import type { TaskDraftMessage } from "@/types/tasks";
import type { AgxTask } from "@/types/tasks";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { Zap, CheckCircle2, Circle, Loader2, Ban, XCircle, ArrowUpRight, Copy, Check } from "lucide-react";
import { ProjectPicker } from "./ProjectPicker";

interface Props {
  draft: TaskDraftMessage;
  onPush?: (draft: TaskDraftMessage, projectId: string, projectName: string) => void;
  pushing?: boolean;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued: <Circle className="w-4 h-4 text-[var(--muted-foreground)]" />,
  pending: <Circle className="w-4 h-4 text-[var(--muted-foreground)]" />,
  in_progress: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  blocked: <Ban className="w-4 h-4 text-amber-500" />,
  completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  done: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  failed: <XCircle className="w-4 h-4 text-rose-500" />,
};

export function TaskStatusCard({ draft, onPush, pushing }: Props) {
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAsMarkdown = useCallback(() => {
    const md = draft.tasks
      .map((t, i) => `${i + 1}. **${t.title}**${t.description ? `\n   ${t.description.replace(/\n/g, "\n   ")}` : ""}`)
      .join("\n");
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [draft.tasks]);

  const { tasks, error } = useTaskPolling({
    projectId: draft.projectId ?? null,
    enabled: !!draft.projectId && draft.buildStatus === "done",
  });

  // Map remote tasks back to draft tasks via builtTaskIds
  const remoteMap = new Map<string, AgxTask>();
  if (draft.builtTaskIds) {
    for (const [clientId, remoteId] of Object.entries(draft.builtTaskIds)) {
      const remote = tasks.find((t) => t.id === remoteId);
      if (remote) remoteMap.set(clientId, remote);
    }
  }

  const completedCount = draft.tasks.filter((t) => {
    const remote = remoteMap.get(t.id);
    return remote && (remote.status === "completed" || remote.status === "done");
  }).length;

  const progress = draft.tasks.length > 0 ? completedCount / draft.tasks.length : 0;

  const handlePushClick = useCallback(() => {
    if (draft.projectId && draft.projectName) {
      onPush?.(draft, draft.projectId, draft.projectName);
    } else {
      setShowProjectPicker(true);
    }
  }, [draft, onPush]);

  const handleProjectSelect = useCallback(
    (projectId: string, projectName: string) => {
      setShowProjectPicker(false);
      onPush?.(draft, projectId, projectName);
    },
    [draft, onPush]
  );

  const hasUnpushed = draft.tasks.some((t) => !draft.builtTaskIds?.[t.id]);
  const hasStartedExecution = draft.tasks.some((t) => {
    const remote = remoteMap.get(t.id);
    return remote && remote.status !== "queued" && remote.status !== "pending";
  });

  return (
    <div className="mt-6 p-4 bg-[var(--app-shell-subtle)]/80 rounded-2xl border border-[var(--border)] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
            Tasks
          </span>
          {draft.projectName && (
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
              · {draft.projectName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[var(--muted-foreground)]">
            {completedCount}/{draft.tasks.length} Complete
          </span>
          {draft.tasks.length > 0 && (
            <button
              type="button"
              onClick={copyAsMarkdown}
              className="text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)] transition-colors"
              title="Copy as markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {draft.tasks.map((task) => {
          const remote = remoteMap.get(task.id);
          const status = remote?.status || "queued";
          const icon = STATUS_ICON[status] || STATUS_ICON.queued;
          const isComplete = status === "completed" || status === "done";

          return (
            <div key={task.id} className="flex items-center gap-3">
              {icon}
              <span
                className={`text-xs font-semibold ${isComplete ? "text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]"}`}
              >
                {task.title}
              </span>
            </div>
          );
        })}
      </div>

      <div className="h-1.5 w-full bg-[var(--muted)] rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)] transition-all duration-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {onPush && !hasStartedExecution && (
        <div className="mt-3 flex items-center gap-3">
          {draft.buildStatus === "partial_failure" && (
            <span className="text-[11px] text-amber-600 font-semibold">
              Some tasks failed to push.
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handlePushClick}
            disabled={pushing}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-[var(--primary-foreground)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-full shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUpRight className="w-3 h-3" />
            {pushing ? "Pushing…" : "Push to agx"}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11px] text-amber-600 font-medium">
          Status polling error: {error}
        </div>
      )}

      {showProjectPicker && (
        <ProjectPicker
          onSelect={handleProjectSelect}
          onClose={() => setShowProjectPicker(false)}
        />
      )}
    </div>
  );
}

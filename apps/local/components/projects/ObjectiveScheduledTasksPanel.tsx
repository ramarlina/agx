"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Pause, Play, Plus, Trash2, X, XCircle } from "lucide-react";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import { cronToHuman } from "@/src/graph/nl-schedule";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";
import { CreateJobModal, type CreateJobData } from "@/components/PromptJobBoard";
import ConfirmDialog from "@/components/ConfirmDialog";
import RichTextEditor from "@/components/RichTextEditor";
import { ScheduleConditionPicker } from "@/components/scheduling/ScheduleConditionPicker";

export type ObjectiveScheduledTaskDraft = CreateJobData;


interface ObjectiveScheduledTasksPanelProps {
  projectId: string;
  objectiveId: string;
  objectiveKey: string;
  createDefaults?: Partial<ObjectiveScheduledTaskDraft>;
  onCreateTask: (draft: ObjectiveScheduledTaskDraft) => Promise<boolean>;
}

function formatCadence(job: Pick<PromptJob, "cadence" | "cronExpr">): string {
  const source = job.cadence || job.cronExpr;
  if (!source) return "No frequency";
  return cronToHuman(job.cronExpr || source) ?? source;
}

function isJobOverdue(job: Pick<PromptJob, "nextRunAt" | "lastRunAt" | "prevScheduledAt" | "state">): boolean {
  if (job.state !== "active") return false;
  if (job.nextRunAt !== null && job.nextRunAt - Date.now() < 0) {
    if (job.lastRunAt && job.lastRunAt >= job.nextRunAt) return false;
    return true;
  }
  if (job.prevScheduledAt && job.lastRunAt) {
    return job.lastRunAt > job.prevScheduledAt + 5 * 60_000;
  }
  return false;
}

function formatNextRun(epochMs: number | null, state: PromptJob["state"]): string {
  if (state === "paused") return "Paused";
  if (state === "stopped") return "Stopped";
  if (epochMs === null) return "Pending";
  const diff = epochMs - Date.now();
  if (diff < 0) return "Overdue";
  if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

function promptSummary(prompt: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "No instructions yet";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ScheduleEditModal({
  job,
  onClose,
  onUpdate,
}: {
  job: PromptJob;
  onClose: () => void;
  onUpdate: (updates: Partial<PromptJob>) => Promise<boolean>;
}) {
  const [scheduleValue, setScheduleValue] = useState({
    cadence: job.cronExpr || job.cadence || "",
    condition: job.condition || "",
  });
  const [isValid, setIsValid] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    await onUpdate({
      cadence: scheduleValue.cadence,
      condition: scheduleValue.condition,
    } as Partial<PromptJob>);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="flex w-full max-w-md max-h-[85vh] flex-col rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-[var(--muted-foreground)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">{job.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-[var(--card-hover-border)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ScheduleConditionPicker
            value={scheduleValue}
            onChange={(next, meta) => {
              setScheduleValue(next);
              setIsValid(meta.isScheduleValid);
            }}
            scheduleLabel="Schedule"
            conditionLabel="Condition"
            conditionHelpText="Scheduled runs and Run now will check this condition before executing."
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !isValid}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ObjectiveScheduledTaskDetailModal({
  job,
  onClose,
  onUpdate,
}: {
  job: PromptJob;
  onClose: () => void;
  onUpdate: (updates: Partial<PromptJob>) => Promise<boolean>;
}) {
  const [promptDraft, setPromptDraft] = useState(job.prompt || "");
  const [saving, setSaving] = useState(false);

  const savePrompt = async () => {
    if (promptDraft === job.prompt) {
      onClose();
      return;
    }
    setSaving(true);
    await onUpdate({ prompt: promptDraft } as Partial<PromptJob>);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="flex w-full max-w-6xl max-h-[85vh] flex-col rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="truncate text-lg font-semibold text-[var(--foreground)]">
                {job.name}
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${stateClasses(job.state)}`}
              >
                {formatState(job.state)}
              </span>
              {job.condition ? (
                <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  gated
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatCadence(job)}
              </span>
              <span>Next run {formatNextRun(job.nextRunAt, job.state)}</span>
              <span>Updated {formatDateTime(job.updatedAt)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-[var(--card-hover-border)] hover:text-[var(--foreground)]"
            aria-label="Close scheduled task details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable editor area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              Instructions
            </p>
            <div className="rounded-2xl border border-[var(--card-hover-border)] bg-[var(--overlay-panel-muted)] px-1 py-1 text-sm leading-6 text-[var(--foreground)]">
              <RichTextEditor
                content={promptDraft}
                editable
                onChange={setPromptDraft}
                placeholder="Write instructions in markdown…"
              />
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void savePrompt()}
            disabled={saving}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatState(state: PromptJob["state"]): string {
  if (state === "active") return "Active";
  if (state === "paused") return "Paused";
  return "Stopped";
}

function stateClasses(state: PromptJob["state"]): string {
  if (state === "active") {
    return "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed)]";
  }
  if (state === "paused") {
    return "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked)]";
  }
  return "border-[var(--tone-neutral-border)] bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral)]";
}

export function ObjectiveScheduledTasksPanel({
  projectId,
  objectiveId,
  objectiveKey,
  createDefaults,
  onCreateTask,
}: ObjectiveScheduledTasksPanelProps) {
  const { jobs, loading, refresh, deleteJob, toggleJob, updateJob, fetchRuns, runNow } = usePromptJobs(projectId, {
    requireProjectId: true,
    includeObjectiveJobs: true,
    objectiveId,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptJob | null>(null);
  const [scheduleEditJobId, setScheduleEditJobId] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<(PromptRun & { jobName: string })[]>([]);

  const visibleJobs = useMemo(() => {
    const filtered = jobs.filter((job) => job.objectiveId === objectiveId);
    // Pin "Objective worker" to the top
    return filtered.sort((a, b) => {
      const aPin = a.name.toLowerCase().includes("objective worker") ? 0 : 1;
      const bPin = b.name.toLowerCase().includes("objective worker") ? 0 : 1;
      return aPin - bPin;
    });
  }, [jobs, objectiveId]);
  const selectedJob = useMemo(
    () => visibleJobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, visibleJobs]
  );

  const loadRecentRuns = useCallback(async () => {
    if (visibleJobs.length === 0) {
      setRecentRuns([]);
      return;
    }
    const allRuns: (PromptRun & { jobName: string })[] = [];
    await Promise.all(
      visibleJobs.map(async (job) => {
        const runs = await fetchRuns(job.id);
        for (const run of runs) {
          allRuns.push({ ...run, jobName: job.name });
        }
      })
    );
    allRuns.sort(
      (a, b) =>
        new Date(b.startedAt ?? b.createdAt).getTime() -
        new Date(a.startedAt ?? a.createdAt).getTime()
    );
    setRecentRuns(allRuns.slice(0, 10));
  }, [visibleJobs, fetchRuns]);

  useEffect(() => {
    void loadRecentRuns();
  }, [loadRecentRuns]);

  const handleHide = async (job: PromptJob) => {
    setBusyId(job.id);
    setError(null);
    const ok = await deleteJob(job.id);
    setBusyId(null);
    if (!ok) {
      setError(`Failed to hide "${job.name}".`);
      return;
    }
    if (selectedJobId === job.id) {
      setSelectedJobId(null);
    }
    await refresh();
  };

  const handleCreate = async (draft: ObjectiveScheduledTaskDraft) => {
    setError(null);
    const ok = await onCreateTask(draft);
    if (ok) {
      await refresh();
    }
    return ok;
  };

  const scheduleEditJob = useMemo(
    () => visibleJobs.find((job) => job.id === scheduleEditJobId) ?? null,
    [scheduleEditJobId, visibleJobs]
  );

  return (
    <>
      {showCreate ? (
        <CreateJobModal
          onClose={() => setShowCreate(false)}
          onSubmit={async (data) => {
            await handleCreate(data);
          }}
          createDefaults={createDefaults}
          contextLabel={objectiveKey}
        />
      ) : null}
      {selectedJob ? (
        <ObjectiveScheduledTaskDetailModal
          job={selectedJob}
          onClose={() => setSelectedJobId(null)}
          onUpdate={async (updates) => {
            const ok = await updateJob(selectedJob.id, updates);
            if (ok) await refresh();
            return ok;
          }}
        />
      ) : null}
      {scheduleEditJob ? (
        <ScheduleEditModal
          job={scheduleEditJob}
          onClose={() => setScheduleEditJobId(null)}
          onUpdate={async (updates) => {
            const ok = await updateJob(scheduleEditJob.id, updates);
            if (ok) await refresh();
            return ok;
          }}
        />
      ) : null}

      <div className="px-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">Scheduled Tasks</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Shared scheduled-task list filtered to objective label{" "}
              <span className="font-mono text-[var(--foreground)]">{objectiveKey}</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
            >
              <Plus className="h-4 w-4" />
              New task
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-[var(--destructive)]">{error}</p>
        ) : null}

        <div className="mt-5 space-y-3">
          {loading && visibleJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-sm text-[var(--muted-foreground)]">
              Loading scheduled tasks...
            </div>
          ) : visibleJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-sm text-[var(--muted-foreground)]">
              No scheduled tasks for this objective yet.
            </div>
          ) : (
            visibleJobs.map((job) => (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedJobId(job.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`block w-full rounded-2xl border px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--card-hover-border)] ${
                  isJobOverdue(job)
                    ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                    : "border-[var(--border)] bg-[var(--overlay-panel-muted)] hover:border-[var(--card-hover-border)]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`inline-block size-2 shrink-0 rounded-full ${
                          job.state === "active"
                            ? "bg-emerald-400"
                            : job.state === "paused"
                              ? "bg-amber-400"
                              : "bg-[var(--tone-neutral)]"
                        }`}
                      />
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {job.name}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${stateClasses(job.state)}`}
                      >
                        {formatState(job.state)}
                      </span>
                      {isJobOverdue(job) && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          overdue
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
                      <span className={`inline-flex items-center gap-1.5 ${isJobOverdue(job) ? "text-amber-400 font-medium" : ""}`}>
                        <Clock className="h-3.5 w-3.5" />
                        Next run {formatNextRun(job.nextRunAt, job.state)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {formatCadence(job)}
                      </span>
                      {job.condition ? (
                        <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                          gated
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {promptSummary(job.prompt)}
                    </p>
                    {job.condition ? (
                      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                        Condition: {job.condition}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      title="Run now"
                      onClick={async (event) => {
                        event.stopPropagation();
                        setBusyId(job.id);
                        await runNow(job.id);
                        setBusyId(null);
                        await refresh();
                        await loadRecentRuns();
                      }}
                      disabled={busyId === job.id}
                      className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-emerald-400/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      title="Edit schedule"
                      onClick={(event) => {
                        event.stopPropagation();
                        setScheduleEditJobId(job.id);
                      }}
                      className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-sky-400/40 hover:text-sky-300"
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title={job.state === "active" ? "Pause" : "Resume"}
                      onClick={async (event) => {
                        event.stopPropagation();
                        setBusyId(job.id);
                        await toggleJob(job);
                        setBusyId(null);
                      }}
                      disabled={busyId === job.id}
                      className={`rounded-lg border p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        job.state === "active"
                          ? "border-[var(--border)] text-[var(--muted-foreground)] hover:border-amber-400/40 hover:text-amber-300"
                          : "border-emerald-500/30 text-emerald-400 hover:border-emerald-400/50 hover:text-emerald-300"
                      }`}
                    >
                      {job.state === "active" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(job);
                      }}
                      disabled={busyId === job.id}
                      className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] transition-colors hover:border-[var(--status-failed-border)] hover:text-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Recent Executions */}
        {recentRuns.length > 0 && (
          <div className="mt-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)] mb-3">
              Recent executions
            </p>
            <div className="space-y-0.5">
              {recentRuns.map((run) => {
                const ts = run.startedAt ?? run.createdAt;
                const isSuccess = run.status === "success";
                const isFailed = run.status === "failed";
                const isRunning = run.status === "running";
                return (
                  <div key={run.id} className="py-2 px-2 rounded-md text-xs">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                          isSuccess
                            ? "border-emerald-500/40 text-emerald-400"
                            : isFailed
                              ? "border-[var(--status-failed-border)] text-[var(--destructive)]"
                              : isRunning
                                ? "border-sky-500/40 text-sky-400"
                                : "border-[var(--border)] text-[var(--muted-foreground)]"
                        }`}
                      >
                        {isSuccess ? (
                          <Check className="h-3 w-3" />
                        ) : isFailed ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <span className={`block size-1.5 rounded-full ${isRunning ? "bg-sky-400 animate-pulse" : "bg-current"}`} />
                        )}
                      </span>
                      <span className="truncate text-[var(--muted-foreground)]">
                        {run.jobName}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--muted-foreground)]">
                        {formatDateTime(ts)}
                      </span>
                      {run.durationMs != null && (
                        <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">
                          {run.durationMs < 1000
                            ? `${run.durationMs}ms`
                            : `${Math.round(run.durationMs / 1000)}s`}
                        </span>
                      )}
                    </div>
                    {isFailed && run.error && (
                      <p className="mt-1 ml-8 text-[11px] leading-snug text-[var(--destructive)] opacity-80 line-clamp-2">
                        {run.error}
                        {run.exitCode != null && ` (exit ${run.exitCode})`}
                      </p>
                    )}
                    {isFailed && run.logs && (
                      <details className="mt-1 ml-8 group">
                        <summary className="cursor-pointer text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] select-none">
                          Show tail logs
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--muted)] px-2 py-1.5 text-[10px] leading-[1.4] text-[var(--foreground)] whitespace-pre-wrap break-words">
                          {run.logs}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete scheduled task?"
        message="This permanently removes the task and all its run history. This cannot be undone."
        preview={deleteTarget?.name}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) {
            void handleHide(deleteTarget);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

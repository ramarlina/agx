"use client";

import { useMemo, useState } from "react";
import { Clock, Plus, Sparkles, Trash2, X } from "lucide-react";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import { cronToHuman } from "@/src/graph/nl-schedule";
import type { PromptJob } from "@/src/prompt-scheduler/types";
import { CreateJobModal, type CreateJobData } from "@/components/PromptJobBoard";

export type ObjectiveScheduledTaskDraft = CreateJobData;

interface ObjectiveScheduledTasksPanelProps {
  projectId: string;
  objectiveId: string;
  objectiveKey: string;
  createDefaults?: Partial<ObjectiveScheduledTaskDraft>;
  onCreateTask: (draft: ObjectiveScheduledTaskDraft) => Promise<boolean>;
  onCreateObjectiveLinearWorker: () => Promise<boolean>;
}

function formatCadence(job: Pick<PromptJob, "cadence" | "cronExpr">): string {
  const source = job.cadence || job.cronExpr;
  if (!source) return "No frequency";
  return cronToHuman(job.cronExpr || source) ?? source;
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

function ObjectiveScheduledTaskDetailModal({
  job,
  onClose,
  onHide,
  hiding,
}: {
  job: PromptJob;
  onClose: () => void;
  onHide: () => Promise<void>;
  hiding: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="w-full max-w-2xl rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
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

        <div className="space-y-5 px-6 py-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              Instructions
            </p>
            <div className="rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] px-4 py-4 text-sm leading-6 text-[var(--foreground)] whitespace-pre-wrap">
              {job.prompt || "No instructions yet"}
            </div>
          </div>

          {job.condition ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Condition
              </p>
              <div className="rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] px-4 py-4 text-sm leading-6 text-[var(--foreground)]">
                {job.condition}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void onHide()}
              disabled={hiding}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/20 px-4 py-2.5 text-sm text-rose-100 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {hiding ? "Hiding..." : "Hide task"}
            </button>
          </div>
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
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (state === "paused") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
}

export function ObjectiveScheduledTasksPanel({
  projectId,
  objectiveId,
  objectiveKey,
  createDefaults,
  onCreateTask,
  onCreateObjectiveLinearWorker,
}: ObjectiveScheduledTasksPanelProps) {
  const { jobs, loading, refresh, deleteJob } = usePromptJobs(projectId, {
    requireProjectId: true,
    includeObjectiveJobs: true,
    objectiveId,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [creatingLinearWorker, setCreatingLinearWorker] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => job.objectiveId === objectiveId),
    [jobs, objectiveId]
  );
  const selectedJob = useMemo(
    () => visibleJobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, visibleJobs]
  );

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

  const handleCreateObjectiveLinearWorker = async () => {
    setCreatingLinearWorker(true);
    setError(null);
    const ok = await onCreateObjectiveLinearWorker();
    setCreatingLinearWorker(false);
    if (!ok) {
      setError("Failed to create the objective Linear worker.");
      return;
    }
    await refresh();
  };

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
          onHide={async () => {
            await handleHide(selectedJob);
          }}
          hiding={busyId === selectedJob.id}
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
              onClick={() => void handleCreateObjectiveLinearWorker()}
              disabled={creatingLinearWorker}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {creatingLinearWorker ? "Creating..." : "Work Linear tickets"}
            </button>
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
          <p className="mt-4 text-sm text-red-300">{error}</p>
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
                className="block w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] px-4 py-4 text-left transition-colors hover:border-[var(--card-hover-border)] focus:outline-none focus:ring-2 focus:ring-[var(--card-hover-border)]"
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
                              : "bg-zinc-500"
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
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Next run {formatNextRun(job.nextRunAt, job.state)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
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

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleHide(job);
                    }}
                    disabled={busyId === job.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {busyId === job.id ? "Hiding..." : "Hide"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ArrowRight } from "lucide-react";
import type { AutomationItem } from "@/app/api/automations/route";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";

interface ScheduledTasksSummaryCardProps {
  projectId: string;
  projectSlug?: string;
  onViewAll?: () => void;
}

type SummaryEntry =
  | {
      id: string;
      title: string;
      kind: "prompt";
      jobId: string;
      runId: string | null;
      updatedAt?: string;
      nextRunAt?: number;
    }
  | {
      id: string;
      title: string;
      kind: "automation";
      updatedAt?: string;
      nextRunAt?: number;
    };

export function ScheduledTasksSummaryCard({
  projectId,
  projectSlug,
  onViewAll,
}: ScheduledTasksSummaryCardProps) {
  const router = useRouter();
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [jobs, setJobs] = useState<PromptJob[]>([]);
  const [latestRuns, setLatestRuns] = useState<Record<string, PromptRun | null>>({});
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [automationsRes, jobsRes] = await Promise.all([
          fetch("/api/automations"),
          fetch(`/api/prompt-jobs?projectId=${encodeURIComponent(projectId)}`),
        ]);

        const automationsData = automationsRes.ok ? await automationsRes.json() : { automations: [] };
        const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };

        if (cancelled) return;

        const projectAutomations = ((automationsData.automations ?? []) as AutomationItem[])
          .filter((automation) => automation.projectId === projectId)
          .slice(0, 20);
        const projectJobs = ((jobsData.jobs ?? []) as PromptJob[])
          .filter((job) => job.projectId === projectId)
          .slice(0, 20);

        setAutomations(projectAutomations);
        setJobs(projectJobs);

        const runsByJobId = Object.fromEntries(await Promise.all(projectJobs.map(async (job) => {
          try {
            const runsRes = await fetch(`/api/prompt-jobs/${encodeURIComponent(job.id)}/runs`);
            if (!runsRes.ok) return [job.id, null];
            const runsData = await runsRes.json();
            const latestRun = ((runsData.runs ?? []) as PromptRun[])[0] ?? null;
            return [job.id, latestRun];
          } catch {
            return [job.id, null];
          }
        })));

        if (cancelled) return;
        setLatestRuns(runsByJobId);
      } catch {
        if (cancelled) return;
        setAutomations([]);
        setJobs([]);
        setLatestRuns({});
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void load();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const openEntry = (entry: SummaryEntry) => {
    if (!projectSlug || entry.kind !== "prompt") return;

    const params = new URLSearchParams({ job: entry.jobId });
    if (entry.runId) {
      params.set("run", entry.runId);
    }
    router.push(`/projects/${projectSlug}/automations?${params.toString()}`);
  };

  const runningEntries: SummaryEntry[] = [
    ...jobs
      .filter((job) => {
        const latestRun = latestRuns[job.id];
        return latestRun?.status === "queued" || latestRun?.status === "running";
      })
      .map((job) => ({
        id: `prompt:${job.id}`,
        title: job.name,
        kind: "prompt" as const,
        jobId: job.id,
        runId: latestRuns[job.id]?.id ?? null,
        updatedAt: latestRuns[job.id]?.createdAt ?? job.updatedAt,
      })),
    ...automations
      .filter((automation) => automation.executionState === "running" || automation.schedule?.tickInProgress)
      .map((automation) => ({
        id: `automation:${automation.graphId}`,
        title: automation.title,
        kind: "automation" as const,
        updatedAt: automation.updatedAt,
      })),
  ]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const runningIds = new Set(runningEntries.map((entry) => entry.id));

  const upcomingEntries: SummaryEntry[] = [
    ...jobs
      .filter((job) => job.state === "active" && typeof job.nextRunAt === "number")
      .map((job) => ({
        id: `prompt:${job.id}`,
        title: job.name,
        kind: "prompt" as const,
        jobId: job.id,
        runId: null,
        nextRunAt: job.nextRunAt as number,
      })),
    ...automations
      .filter((automation) => automation.schedule?.state === "active" && typeof automation.schedule?.nextTickAt === "number")
      .map((automation) => ({
        id: `automation:${automation.graphId}`,
        title: automation.title,
        kind: "automation" as const,
        nextRunAt: automation.schedule.nextTickAt as number,
      })),
  ]
    .filter((entry) => !runningIds.has(entry.id))
    .sort((left, right) => left.nextRunAt - right.nextRunAt);

  const scheduledCount = jobs.length + automations.length;

  const formatNextRun = (timestamp?: number) => {
    if (typeof timestamp !== "number") return "No next run";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  const formatCountdown = (timestamp?: number) => {
    if (typeof timestamp !== "number") return "";

    const diffMs = timestamp - nowMs;
    if (diffMs <= 0) return "now";

    const totalMinutes = Math.ceil(diffMs / 60_000);
    if (totalMinutes < 60) return `in ${totalMinutes}m`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) {
      return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `in ${days}d`;
    return `in ${days}d ${remainingHours}h`;
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Scheduled Tasks</span>
          {!loading && scheduledCount > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {scheduledCount}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 rounded bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : scheduledCount === 0 ? (
        <p className="text-sm text-zinc-500">No scheduled tasks</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
              <span>Currently running</span>
              <span>{runningEntries.length}</span>
            </div>
            {runningEntries.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing running right now</p>
            ) : (
              <div className="space-y-2">
                {runningEntries.slice(0, 3).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry)}
                    disabled={entry.kind !== "prompt" || !projectSlug}
                    className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm transition-colors ${
                      entry.kind === "prompt" && projectSlug
                        ? "cursor-pointer hover:bg-zinc-800/70"
                        : "cursor-default"
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate text-zinc-300">{entry.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-emerald-400">running</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
              <span>Upcoming runs</span>
              <span>{upcomingEntries.length}</span>
            </div>
            {upcomingEntries.length === 0 ? (
              <p className="text-sm text-zinc-500">No upcoming runs</p>
            ) : (
              <div className="space-y-2">
                {upcomingEntries.slice(0, 3).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry)}
                    disabled={entry.kind !== "prompt" || !projectSlug}
                    className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm transition-colors ${
                      entry.kind === "prompt" && projectSlug
                        ? "cursor-pointer hover:bg-zinc-800/70"
                        : "cursor-default"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-zinc-300">{entry.title}</div>
                      <div className="text-xs text-zinc-500">
                        {formatNextRun(entry.nextRunAt)}{" "}
                        <span className="text-zinc-400">• {formatCountdown(entry.nextRunAt)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

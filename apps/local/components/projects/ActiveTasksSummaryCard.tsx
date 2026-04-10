"use client";

import { useEffect, useState } from "react";
import { Zap, ArrowRight } from "lucide-react";

type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Job {
  id: string;
  title?: string;
  state: JobState;
}

interface ActiveTasksSummaryCardProps {
  projectId: string;
  onViewAll?: () => void;
}

const dotColor: Record<string, string> = {
  running: "bg-emerald-400",
  queued: "bg-yellow-400",
  failed: "bg-red-400",
};

export function ActiveTasksSummaryCard({ projectId, onViewAll }: ActiveTasksSummaryCardProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/prompt-jobs?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((data) => setJobs(data.jobs ?? []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const active = jobs.filter((j) => j.state === "running" || j.state === "queued");
  const failed = jobs.filter((j) => j.state === "failed");
  const shown = [...active, ...failed].slice(0, 5);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Active Tasks</span>
          {!loading && active.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {active.length}
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
      ) : shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No active tasks</p>
      ) : (
        <div className="space-y-2">
          {shown.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor[job.state] ?? "bg-zinc-600"}`} />
              <span className="text-zinc-300 truncate">{job.title || job.id.slice(0, 8)}</span>
              <span className="text-zinc-500 text-xs ml-auto shrink-0">{job.state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

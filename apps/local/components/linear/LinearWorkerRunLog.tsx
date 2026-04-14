"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Ban } from "lucide-react";
import type { PromptRun } from "@/src/prompt-scheduler/types";

interface LinearWorkerRunLogProps {
  jobId: string | null;
}

function StatusIcon({ status }: { status: PromptRun["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 size={14} className="text-emerald-400" />;
    case "failed":
      return <XCircle size={14} className="text-red-400" />;
    case "running":
      return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    case "queued":
      return <Clock size={14} className="text-yellow-400" />;
    case "cancelled":
      return <Ban size={14} className="text-[var(--muted-foreground)]" />;
    default:
      return <Clock size={14} className="text-[var(--muted-foreground)]" />;
  }
}

function statusLabel(status: PromptRun["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(status: PromptRun["status"]): string {
  switch (status) {
    case "success":
      return "text-emerald-400";
    case "failed":
      return "text-red-400";
    case "running":
      return "text-blue-400";
    case "queued":
      return "text-yellow-400";
    case "cancelled":
      return "text-[var(--muted-foreground)]";
    default:
      return "text-[var(--muted-foreground)]";
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.round(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function LinearWorkerRunLog({ jobId }: LinearWorkerRunLogProps) {
  const [runs, setRuns] = useState<PromptRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const initialFetch = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/prompt-jobs/${jobId}/runs`);
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!initialFetch.current) {
      initialFetch.current = true;
      fetchRuns();
    }
  }, [fetchRuns]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(fetchRuns, 10_000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  if (!jobId) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
        No worker configured yet. Enable the worker to see run history.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-[var(--muted-foreground)]">
        <RefreshCw size={14} className="animate-spin" />
        Loading run history...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
        No runs yet. The worker will log runs here once it starts executing.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_100px_140px_140px_90px] gap-3 px-4 py-2 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest border-b border-[var(--card-border)]">
        <span>Status</span>
        <span>Duration</span>
        <span>Started</span>
        <span>Finished</span>
        <span>Run ID</span>
      </div>

      {/* Rows */}
      <div className="max-h-[60vh] overflow-y-auto">
        {runs.map((run) => (
          <div key={run.id}>
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_100px_140px_140px_90px] gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--card-bg)] rounded-lg"
            >
              <span className={`flex items-center gap-2 font-medium ${statusColor(run.status)}`}>
                <StatusIcon status={run.status} />
                {statusLabel(run.status)}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {formatDuration(run.durationMs)}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {formatTime(run.startedAt)}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {formatTime(run.finishedAt)}
              </span>
              <span className="text-[var(--muted-foreground)] font-mono text-xs truncate">
                {run.id.slice(0, 8)}
              </span>
            </button>

            {/* Expanded detail */}
            {expandedId === run.id && (run.output || run.error) && (
              <div className="mx-4 mb-2 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] overflow-hidden">
                {run.error && (
                  <div className="px-4 py-3 border-b border-[var(--card-border)]">
                    <div className="text-[10px] font-semibold text-red-400 uppercase tracking-widest mb-1">Error</div>
                    <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono">{run.error}</pre>
                  </div>
                )}
                {run.output && (
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1">Output</div>
                    <pre className="text-xs text-[var(--foreground)] whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">{run.output}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

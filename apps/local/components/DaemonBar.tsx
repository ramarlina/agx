"use client";

import { useEffect, useState, useCallback } from "react";
import { UI_POLL_DAEMON_STATUS_MS } from "@/lib/constants/timing";

interface DaemonStatus {
  running: boolean;
  targetWorkers: number;
  activeWorkers: number;
  maxWorkers: number;
  startedAt: string | null;
}

export default function DaemonBar() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/daemon");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, UI_POLL_DAEMON_STATUS_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const toggle = async () => {
    setLoading(true);
    try {
      if (status?.running) {
        await fetch("/api/daemon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        });
      } else {
        await fetch("/api/daemon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workers: 1 }),
        });
      }
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const scale = async (delta: number) => {
    if (!status) return;
    const next = Math.max(1, Math.min(status.maxWorkers, status.targetWorkers + delta));
    if (next === status.targetWorkers) return;
    setLoading(true);
    try {
      await fetch("/api/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workers: next }),
      });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  const running = status.running;

  return (
    <div className="flex items-center gap-3 py-2 text-xs text-[var(--muted-foreground)]">
      {/* Status dot + label */}
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] hover:border-[var(--border)] transition-colors disabled:opacity-50"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${running ? "bg-emerald-500" : "bg-[var(--app-shell-soft-text)]"}`}
        />
        <span className="font-medium text-[var(--muted-foreground)]">
          {loading ? "..." : running ? "Daemon running" : "Daemon stopped"}
        </span>
      </button>

      {running && (
        <>
          {/* Worker count with +/- */}
          <div className="inline-flex items-center rounded-full border border-[var(--border)] overflow-hidden">
            <button
              type="button"
              onClick={() => scale(-1)}
              disabled={loading || status.targetWorkers <= 1}
              className="px-1.5 py-0.5 hover:bg-[var(--muted)] transition-colors disabled:opacity-30 text-[var(--muted-foreground)]"
            >
              -
            </button>
            <span className="px-2 py-0.5 font-mono text-[var(--muted-foreground)] border-x border-[var(--border)]">
              {status.activeWorkers}/{status.targetWorkers}w
            </span>
            <button
              type="button"
              onClick={() => scale(1)}
              disabled={loading || status.targetWorkers >= status.maxWorkers}
              className="px-1.5 py-0.5 hover:bg-[var(--muted)] transition-colors disabled:opacity-30 text-[var(--muted-foreground)]"
            >
              +
            </button>
          </div>

          {/* Uptime */}
          {status.startedAt && (
            <span className="text-[var(--muted-foreground)]">
              up since {new Date(status.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </>
      )}
    </div>
  );
}

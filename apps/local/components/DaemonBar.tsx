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

async function readDaemonError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.error === "string") {
      return data.error;
    }
  } catch {}

  return fallback;
}

export default function DaemonBar() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/daemon", { cache: "no-store" });
      if (!res.ok) {
        setStatus(null);
        setError(
          await readDaemonError(
            res,
            res.status === 401 || res.status === 403
              ? "Daemon control is not available from this caller."
              : `Could not load daemon status (${res.status}).`,
          ),
        );
        return;
      }

      setStatus(await res.json());
      setError(null);
    } catch {
      setStatus(null);
      setError("Could not load daemon status.");
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
        const res = await fetch("/api/daemon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        });
        if (!res.ok) {
          setError(
            await readDaemonError(
              res,
              `Could not update daemon state (${res.status}).`,
            ),
          );
          setStatus(null);
          return;
        }
      } else {
        const res = await fetch("/api/daemon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workers: 1 }),
        });
        if (!res.ok) {
          setError(
            await readDaemonError(
              res,
              `Could not update daemon state (${res.status}).`,
            ),
          );
          setStatus(null);
          return;
        }
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
      const res = await fetch("/api/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workers: next }),
      });
      if (!res.ok) {
        setError(
          await readDaemonError(
            res,
            `Could not update daemon state (${res.status}).`,
          ),
        );
        setStatus(null);
        return;
      }
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  if (!status) {
    return error ? (
      <div className="py-2 text-xs text-amber-600">{error}</div>
    ) : null;
  }

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

      {error ? <span className="text-amber-600">{error}</span> : null}
    </div>
  );
}

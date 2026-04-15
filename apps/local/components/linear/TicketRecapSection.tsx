"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { Markdown } from "@/components/chat-ui/Markdown";

interface RecapResponse {
  content: string | null;
  generatedAt: string | null;
  filePath: string | null;
  status: "idle" | "queued" | "running" | "failed";
  error: string | null;
}

interface Props {
  issueId: string;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function TicketRecapSection({ issueId }: Props) {
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRecap = useCallback(async () => {
    try {
      const res = await fetch(`/api/linear/issues/${encodeURIComponent(issueId)}/recap`);
      if (!res.ok) return null;
      const data = (await res.json()) as RecapResponse;
      setRecap(data);
      return data;
    } catch {
      return null;
    }
  }, [issueId]);

  const scheduleIfBusy = useCallback(
    (data: RecapResponse | null | undefined) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (data?.status === "queued" || data?.status === "running") {
        timerRef.current = setTimeout(async () => {
          const next = await fetchRecap();
          scheduleIfBusy(next);
        }, 3000);
      }
    },
    [fetchRecap]
  );

  useEffect(() => {
    setRecap(null);
    void (async () => {
      const data = await fetchRecap();
      scheduleIfBusy(data);
    })();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [issueId, fetchRecap, scheduleIfBusy]);

  const regenerate = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`/api/linear/issues/${encodeURIComponent(issueId)}/recap`, {
        method: "POST",
      });
      const data = await fetchRecap();
      scheduleIfBusy(data);
    } finally {
      setLoading(false);
    }
  }, [issueId, fetchRecap, scheduleIfBusy]);

  const busy = recap?.status === "queued" || recap?.status === "running" || loading;

  return (
    <section className="border-b border-[var(--card-border)] px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Recap
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
          {busy ? (
            <span className="flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Updating…
            </span>
          ) : (
            <span>Updated {formatRelative(recap?.generatedAt ?? null)}</span>
          )}
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="flex items-center gap-1 rounded border border-[var(--card-border)] px-2 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={10} />
            Regenerate
          </button>
        </div>
      </div>
      <div className="text-sm text-[var(--foreground)]">
        {recap?.content ? (
          <Markdown content={recap.content} isUser={false} />
        ) : (
          <p className="text-[var(--muted-foreground)]">
            No recap yet. Click Regenerate to create one.
          </p>
        )}
        {recap?.error ? (
          <p className="mt-2 text-xs text-red-400">Last run failed: {recap.error}</p>
        ) : null}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { MessageSquare, ArrowRight } from "lucide-react";

interface RecentThreadsSummaryCardProps {
  projectId: string;
  onSelectThread?: (thread: RecentThreadEntry) => void;
  onViewAll?: () => void;
  title?: string;
  emptyLabel?: string;
}

export interface RecentThreadEntry {
  id: string;
  threadId: string;
  title: string;
  status: string;
  lastActivity: number;
}

interface WorkspaceGroup {
  name: string;
  threads: RecentThreadEntry[];
}

export function RecentThreadsSummaryCard({
  projectId,
  onSelectThread,
  onViewAll,
  title = "Recent Threads",
  emptyLabel = "No threads yet",
}: RecentThreadsSummaryCardProps) {
  const [recent, setRecent] = useState<RecentThreadEntry[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setRecent(null);
    fetch(`/api/threads?projectId=${encodeURIComponent(projectId)}&limit=5&format=json`)
      .then((response) => (response.ok ? response.json() : { threads: {}, total: 0 }))
      .then((data) => {
        if (cancelled) return;
        const groups = Object.values((data.threads ?? {}) as Record<string, WorkspaceGroup>);
        const threads = groups
          .flatMap((group) => group.threads ?? [])
          .sort((left, right) => right.lastActivity - left.lastActivity)
          .slice(0, 5);

        setRecent(threads);
        setTotal(typeof data.total === "number" ? data.total : threads.length);
      })
      .catch(() => {
        if (cancelled) return;
        setRecent([]);
        setTotal(0);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">{title}</span>
          {total > 0 && (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {total}
            </span>
          )}
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {recent === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((id) => (
            <div key={id} className="h-8 rounded-2xl bg-[var(--muted)] animate-pulse" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{emptyLabel}</p>
      ) : (
        <div className="space-y-1.5">
          {recent.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelectThread?.(thread)}
              className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--secondary)]"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              <span className="truncate text-[var(--foreground)]">{thread.title}</span>
              <span className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]">
                {thread.status.replace(/-/g, " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

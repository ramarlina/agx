"use client";

import { useEffect, useState } from "react";
import { MessageSquare, ArrowRight } from "lucide-react";

interface RecentThreadsSummaryCardProps {
  projectId: string;
  onSelectThread?: (thread: RecentThreadEntry) => void;
  onViewAll?: () => void;
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Recent Threads</span>
          {total > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {total}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {recent === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((id) => (
            <div key={id} className="h-8 rounded bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="text-sm text-zinc-500">No threads yet</p>
      ) : (
        <div className="space-y-1.5">
          {recent.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread?.(thread)}
              className="flex items-center gap-2 text-sm w-full text-left rounded-lg px-2 py-1.5 hover:bg-zinc-800 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-300 truncate">{thread.title}</span>
              <span className="ml-auto shrink-0 text-xs text-zinc-500">
                {thread.status.replace(/-/g, " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

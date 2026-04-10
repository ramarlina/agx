"use client";

import { MessageSquare, ArrowRight } from "lucide-react";

interface RecentThreadsSummaryCardProps {
  threadIds: string[];
  projectSlug: string;
  onSelectThread?: (threadId: string) => void;
  onViewAll?: () => void;
}

export function RecentThreadsSummaryCard({
  threadIds,
  projectSlug,
  onSelectThread,
  onViewAll,
}: RecentThreadsSummaryCardProps) {
  const recent = threadIds.slice(0, 5);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Recent Threads</span>
          {threadIds.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {threadIds.length}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {recent.length === 0 ? (
        <p className="text-sm text-zinc-500">No threads yet</p>
      ) : (
        <div className="space-y-1.5">
          {recent.map((id) => (
            <button
              key={id}
              onClick={() => onSelectThread?.(id)}
              className="flex items-center gap-2 text-sm w-full text-left rounded-lg px-2 py-1.5 hover:bg-zinc-800 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-300 truncate font-mono text-xs">
                {id.slice(0, 12)}...
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

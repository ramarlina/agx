"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Activity, Filter } from "lucide-react";
import { Markdown } from "@/components/chat-ui/Markdown";
import type {
  ObjectiveActivityFile,
  ObjectiveActivityType,
  ObjectiveActivityPage,
} from "@/src/objectives/activities/types";

interface ObjectiveActivityTimelineProps {
  projectId: string;
  objectiveId: string;
}

const TYPE_META: Record<ObjectiveActivityType, { label: string; className: string }> = {
  "metric-check": {
    label: "Metric",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  "status-update": {
    label: "Status",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  milestone: {
    label: "Milestone",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  note: {
    label: "Note",
    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
};

const ALL_TYPES: ObjectiveActivityType[] = ["metric-check", "status-update", "milestone", "note"];

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return isoDate;

  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: diffDays > 365 ? "numeric" : undefined,
  });
}

function ActivityEntry({ activity }: { activity: ObjectiveActivityFile }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[activity.type] ?? TYPE_META.note;
  const preview =
    activity.body.length > 200 ? `${activity.body.slice(0, 200).trim()}…` : activity.body;
  const hasMore = activity.body.length > 200;

  return (
    <div className="relative pl-6 pb-6 last:pb-0">
      <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-zinc-600 bg-[#131315]" />
      <div className="absolute left-[5px] top-4 bottom-0 w-px bg-zinc-800 last:hidden" />

      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.className}`}
        >
          {meta.label}
        </span>
        <span className="text-[11px] text-zinc-500">{formatRelativeTime(activity.createdAt)}</span>
        {activity.source !== "manual" && (
          <span className="text-[11px] text-zinc-600 font-mono truncate max-w-[180px]">
            {activity.source}
          </span>
        )}
      </div>

      {expanded ? (
        <div className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none">
          <Markdown content={activity.body} />
        </div>
      ) : (
        <p className="text-sm text-zinc-400 leading-relaxed">{preview}</p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function ObjectiveActivityTimeline({
  projectId,
  objectiveId,
}: ObjectiveActivityTimelineProps) {
  const [activities, setActivities] = useState<ObjectiveActivityFile[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<ObjectiveActivityType | "all">("all");
  const [showFilter, setShowFilter] = useState(false);

  const fetchActivities = useCallback(
    async (pageNum: number, type: ObjectiveActivityType | "all", append: boolean) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(pageNum), limit: "25" });
        if (type !== "all") params.set("type", type);

        const response = await fetch(
          `/api/projects/${projectId}/objectives/${objectiveId}/activities?${params}`,
        );
        if (!response.ok) throw new Error("Failed to load activities");

        const data = (await response.json()) as ObjectiveActivityPage;
        setActivities((prev) => (append ? [...prev, ...data.activities] : data.activities));
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (error) {
        console.error("Failed to fetch activities:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, objectiveId],
  );

  useEffect(() => {
    setPage(1);
    void fetchActivities(1, typeFilter, false);
  }, [fetchActivities, typeFilter]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchActivities(nextPage, typeFilter, true);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Activity size={14} /> Activity Timeline
            {total > 0 && (
              <span className="text-[10px] bg-zinc-800 text-zinc-400 rounded-full px-1.5 py-0.5 font-mono">
                {total}
              </span>
            )}
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Time-ordered log of outputs from scheduled tasks and manual entries.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowFilter(!showFilter)}
          className={`p-1.5 rounded-md transition-colors ${
            showFilter || typeFilter !== "all"
              ? "text-sky-400 bg-sky-500/10"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
          aria-label="Filter activities"
        >
          <Filter size={14} />
        </button>
      </div>

      {showFilter && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              typeFilter === "all"
                ? "bg-zinc-200 text-zinc-900 border-zinc-200"
                : "bg-zinc-800/50 text-zinc-400 border-zinc-700 hover:border-zinc-500"
            }`}
          >
            All
          </button>
          {ALL_TYPES.map((type) => {
            const meta = TYPE_META[type];
            const isActive = typeFilter === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  isActive
                    ? "bg-zinc-200 text-zinc-900 border-zinc-200"
                    : `${meta.className} hover:opacity-80`
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {isLoading && activities.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">Loading activities...</div>
      ) : activities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-900/30 p-6 text-center">
          <p className="text-sm text-zinc-500">No activities yet.</p>
          <p className="text-xs text-zinc-600 mt-1">
            Activities are created by scheduled tasks and agent actions.
          </p>
        </div>
      ) : (
        <div>
          {activities.map((activity) => (
            <ActivityEntry key={activity.id} activity={activity} />
          ))}
          {hasMore && (
            <div className="pt-2 pl-6">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoading}
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

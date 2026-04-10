"use client";

import { useEffect, useState } from "react";
import { Clock, ArrowRight } from "lucide-react";
import type { AutomationItem } from "@/app/api/automations/route";

interface ScheduledTasksSummaryCardProps {
  projectId: string;
  onViewAll?: () => void;
}

export function ScheduledTasksSummaryCard({ projectId, onViewAll }: ScheduledTasksSummaryCardProps) {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/automations")
      .then((r) => (r.ok ? r.json() : { automations: [] }))
      .then((data) => {
        const items = (data.automations ?? []) as AutomationItem[];
        setAutomations(items.filter((a) => a.taskId === projectId || true).slice(0, 20));
      })
      .catch(() => setAutomations([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const stateColor: Record<string, string> = {
    active: "text-emerald-400",
    paused: "text-yellow-400",
    stopped: "text-zinc-500",
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Scheduled</span>
          {!loading && automations.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {automations.length}
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
      ) : automations.length === 0 ? (
        <p className="text-sm text-zinc-500">No scheduled tasks</p>
      ) : (
        <div className="space-y-2">
          {automations.slice(0, 5).map((auto) => (
            <div key={auto.graphId} className="flex items-center gap-2 text-sm">
              <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-300 truncate">{auto.graphId.slice(0, 12)}</span>
              <span className={`text-xs ml-auto shrink-0 ${stateColor[auto.schedule?.state] ?? "text-zinc-500"}`}>
                {auto.schedule?.state ?? "unknown"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { Target } from "lucide-react";
import type { ProjectObjective, ProjectObjectiveHealth } from "@/lib/project-objectives";

interface ObjectiveCardProps {
  objective: ProjectObjective;
  teamName: string | null;
  onClick: () => void;
}

const HEALTH_CONFIG: Record<ProjectObjectiveHealth, { label: string; dot: string; badge: string }> = {
  on_track: { label: "On Track", dot: "bg-emerald-400", badge: "text-emerald-400 border-emerald-700/60 bg-emerald-500/10" },
  at_risk: { label: "At Risk", dot: "bg-amber-400", badge: "text-amber-400 border-amber-700/60 bg-amber-500/10" },
  off_track: { label: "Off Track", dot: "bg-red-400", badge: "text-red-400 border-red-700/60 bg-red-500/10" },
  done: { label: "Done", dot: "bg-zinc-400", badge: "text-zinc-400 border-zinc-700/60 bg-zinc-500/10" },
};

export function ObjectiveCard({ objective, teamName, onClick }: ObjectiveCardProps) {
  const health = HEALTH_CONFIG[objective.status] ?? HEALTH_CONFIG.on_track;
  const isDone = objective.status === "done";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-800/50 ${isDone ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${health.dot}`} />
          <span className="text-sm font-medium text-zinc-200 truncate">{objective.title}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${health.badge}`}>
          {health.label}
        </span>
      </div>

      <div className="mb-2">
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500/70 transition-all"
            style={{ width: `${Math.min(objective.progress, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{teamName ?? "No team"}</span>
        <span>{objective.progress}%</span>
      </div>
    </button>
  );
}

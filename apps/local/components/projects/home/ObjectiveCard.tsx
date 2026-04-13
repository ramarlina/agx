"use client";

import { Target } from "lucide-react";
import type { ProjectObjective, ProjectObjectiveHealth } from "@/lib/project-objectives";

interface ObjectiveCardProps {
  objective: ProjectObjective;
  teamName: string | null;
  onClick: () => void;
}

const HEALTH_CONFIG: Record<ProjectObjectiveHealth, { label: string; dot: string; badge: string }> = {
  on_track: { label: "On Track", dot: "bg-[var(--status-completed)]", badge: "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]" },
  at_risk: { label: "At Risk", dot: "bg-[var(--status-blocked)]", badge: "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked-text)]" },
  off_track: { label: "Off Track", dot: "bg-[var(--status-failed)]", badge: "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-text)]" },
  done: { label: "Done", dot: "bg-[var(--muted-foreground)]", badge: "border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)]" },
};

export function ObjectiveCard({ objective, teamName, onClick }: ObjectiveCardProps) {
  const health = HEALTH_CONFIG[objective.status] ?? HEALTH_CONFIG.on_track;
  const isDone = objective.status === "done";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-left transition-colors hover:bg-[var(--secondary)] ${isDone ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${health.dot}`} />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">{objective.title}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${health.badge}`}>
          {health.label}
        </span>
      </div>

      <div className="mb-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full bg-emerald-500/70 transition-all"
            style={{ width: `${Math.min(objective.progress, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>{teamName ?? "No team"}</span>
        <span>{objective.progress}%</span>
      </div>
    </button>
  );
}

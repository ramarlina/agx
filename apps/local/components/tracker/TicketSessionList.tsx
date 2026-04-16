"use client";
import { ArrowRight, Clock } from "lucide-react";
import type { TrackerRunRecord } from "@/lib/tracker/tracker-run-store";
import {
  getRunDisplayState,
  getRunTitle,
  STATUS_BADGE_STYLES,
  STATUS_DOT_COLORS,
} from "@/lib/tracker-run-status";

interface Props {
  runs: TrackerRunRecord[];
  onSelect: (runId: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TicketSessionList({ runs, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
        No sessions yet. Start one below.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {runs.map((run) => {
        const display = getRunDisplayState(run);
        return (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelect(run.id)}
            className="flex w-full items-start justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--overlay-panel-soft)]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {getRunTitle(run)}
              </p>
              <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                <span>{run.agentName}</span>
                <span>·</span>
                <Clock size={10} />
                <span>{formatTime(run.updatedAt)}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${STATUS_BADGE_STYLES[display.tone]}`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[display.tone]}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  {display.label}
                </span>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 text-[var(--muted-foreground)]" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

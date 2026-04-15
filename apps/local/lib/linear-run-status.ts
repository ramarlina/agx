import type { LinearRun } from "@/hooks/useLinearRuns";

export type RunDisplayTone = LinearRun["status"] | "ready";

export function formatRunStatus(status: LinearRun["status"]): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

export function getRunDisplayState(run: LinearRun): {
  label: string;
  tone: RunDisplayTone;
} {
  if (run.mode === "chat") {
    switch (run.status) {
      case "queued":
        return { label: "starting", tone: "queued" };
      case "running":
        return { label: "thinking", tone: "running" };
      case "success":
        return { label: "ready", tone: "ready" };
      case "failed":
        return { label: "error", tone: "failed" };
      case "cancelled":
        return { label: "stopped", tone: "cancelled" };
      default:
        return { label: formatRunStatus(run.status), tone: run.status };
    }
  }

  return { label: formatRunStatus(run.status), tone: run.status };
}

export function getRunTitle(run: LinearRun): string {
  const title = run.sessionTitle?.trim();
  if (title) {
    return title;
  }
  return run.mode === "scripted" ? "Scripted session" : "Chat session";
}

export const STATUS_LABELS: Record<string, string> = {
  "In Progress": "In Prog",
  "In Review": "Review",
  Backlog: "Backlog",
  Todo: "Todo",
  Done: "Done",
  Cancelled: "Cancl.",
};

export const STATUS_BADGE_STYLES: Record<RunDisplayTone, string> = {
  queued: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  running: "bg-yellow-500/10 border-yellow-500/20 text-yellow-400",
  ready: "bg-sky-500/10 border-sky-500/20 text-sky-400",
  success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/10 border-red-500/20 text-red-400",
  cancelled: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
};

export const STATUS_DOT_COLORS: Record<RunDisplayTone, string> = {
  queued: "bg-amber-400",
  running: "bg-yellow-400",
  ready: "bg-sky-400",
  success: "bg-emerald-400",
  failed: "bg-red-400",
  cancelled: "bg-zinc-400",
};

export const STATUS_TEXT_COLORS: Record<RunDisplayTone, string> = {
  queued: "text-amber-500",
  running: "text-yellow-500",
  ready: "text-sky-500",
  success: "text-green-500",
  failed: "text-red-500",
  cancelled: "text-[var(--muted-foreground)]",
};

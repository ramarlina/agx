type ScheduleState = "active" | "paused" | "stopped" | string;

interface ScheduledRunStatusInput {
  state: ScheduleState;
  nextScheduledAt: number | null | undefined;
  lastCompletedAt: number | null | undefined;
  inProgress?: boolean;
  now?: number;
}

interface IntervalScheduleStatusInput {
  state: ScheduleState;
  lastCompletedAt: number | null | undefined;
  intervalMs: number;
  inProgress?: boolean;
  now?: number;
}

export function isScheduledRunOverdue({
  state,
  nextScheduledAt,
  lastCompletedAt,
  inProgress = false,
  now = Date.now(),
}: ScheduledRunStatusInput): boolean {
  if (state !== "active" || inProgress) return false;
  if (nextScheduledAt == null || nextScheduledAt >= now) return false;
  if (lastCompletedAt != null && lastCompletedAt >= nextScheduledAt) return false;
  return true;
}

export function isIntervalScheduleOverdue({
  state,
  lastCompletedAt,
  intervalMs,
  inProgress = false,
  now = Date.now(),
}: IntervalScheduleStatusInput): boolean {
  if (state !== "active" || inProgress) return false;
  if (lastCompletedAt == null) return false;
  return lastCompletedAt + intervalMs < now;
}

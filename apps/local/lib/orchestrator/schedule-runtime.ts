import { writeDebugLog } from "@/lib/debug-log";
import { createDispatchFunction } from "@/src/graph/function-executor";
import { pollSchedules } from "@/src/graph/schedule-runner";
import { createDispatchWork } from "@/src/graph/work-dispatcher";

const DEFAULT_SCHEDULE_POLL_INTERVAL_MS = 5_000;

let pollIntervalHandle: NodeJS.Timeout | null = null;
let pollInFlight: Promise<void> | null = null;

function isSchedulePollingEnabled(): boolean {
  return process.env.AGX_DISABLE_SCHEDULE_POLLING !== "1";
}

function getSchedulePollIntervalMs(): number {
  const raw = Number(process.env.AGX_SCHEDULE_POLL_INTERVAL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_SCHEDULE_POLL_INTERVAL_MS;
  return Math.max(1_000, raw);
}

async function pollSchedulesOnce(): Promise<void> {
  if (pollInFlight) {
    return pollInFlight;
  }

  pollInFlight = (async () => {
    const result = await pollSchedules({
      dispatchFunction: createDispatchFunction(),
      dispatchWork: createDispatchWork(),
    });

    if (result.errors.length > 0) {
      writeDebugLog("schedule_runtime.poll.error", {
        errorCount: result.errors.length,
        graphIds: result.errors.map((entry) => entry.graphId),
      });
    }
  })()
    .catch((error) => {
      writeDebugLog("schedule_runtime.poll.exception", { error });
      console.error("[schedule-runtime] Poll failed:", error);
    })
    .finally(() => {
      pollInFlight = null;
    });

  return pollInFlight;
}

export async function ensureScheduleRuntime(): Promise<void> {
  if (!isSchedulePollingEnabled() || pollIntervalHandle) {
    return;
  }

  const intervalMs = getSchedulePollIntervalMs();
  writeDebugLog("schedule_runtime.start", { intervalMs });

  pollIntervalHandle = setInterval(() => {
    void pollSchedulesOnce();
  }, intervalMs);
  if (typeof pollIntervalHandle.unref === "function") {
    pollIntervalHandle.unref();
  }

  await pollSchedulesOnce();
}

export async function stopScheduleRuntime(): Promise<void> {
  if (pollIntervalHandle) {
    clearInterval(pollIntervalHandle);
    pollIntervalHandle = null;
  }
  if (pollInFlight) {
    await pollInFlight;
  }
}

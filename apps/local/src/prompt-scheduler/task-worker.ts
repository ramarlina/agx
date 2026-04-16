// Task worker — tracker-agnostic replacement for linear-worker.
// Dispatches to the appropriate tracker adapter based on job.trackerType.
// Both 'linear' and 'jira' use the same worker pipeline (linear-worker)
// since the pipeline is tracker-agnostic — it reads items from the
// tracker-item-store which is shared across all adapters.

import { executeLinearWorker, buildLinearWorkerObservation } from './linear-worker';
import type { ChatProvider } from '@/lib/types';
import type { Participant } from '@/lib/types';
import type { PromptJob } from './types';

/**
 * Determine which tracker adapter a task worker job should use.
 * Falls back to 'linear' if trackerType is not set (backward compat).
 */
function resolveTrackerType(job: PromptJob): string {
  return (job as PromptJob & { trackerType?: string }).trackerType?.trim() || 'linear';
}

/**
 * Execute a task worker job.
 * Currently delegates directly to the Linear worker.
 * Phase 2: Will dispatch based on `resolveTrackerType(job)`.
 */
export async function executeTaskWorker(opts: {
  job: PromptJob;
  controllerContext: {
    provider: ChatProvider;
    model: string | null;
    identity: string | undefined;
    self: string | undefined;
    skills: string | undefined;
  };
  sessionAgent: Participant;
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
}): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  const trackerType = resolveTrackerType(opts.job);

  // All registered tracker types use the same worker pipeline.
  // The pipeline is tracker-agnostic — it fetches items from
  // tracker-item-store (shared across all adapters) and injects
  // context into the agent prompt.
  if (trackerType === 'linear' || trackerType === 'jira') {
    return executeLinearWorker(opts);
  }

  return {
    output: '',
    error: `Unknown tracker type: ${trackerType}`,
    durationMs: 0,
    status: 'failed',
  };
}

/**
 * Build the observation prompt for a task worker job.
 * Currently delegates to buildLinearWorkerObservation.
 */
export { buildLinearWorkerObservation as buildTaskWorkerObservation };
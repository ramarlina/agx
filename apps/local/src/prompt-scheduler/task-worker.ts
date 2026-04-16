// Task worker — tracker-agnostic replacement for linear-worker.
// Phase 1: Delegates to the linear-worker logic since Linear is the only
// tracker adapter. When additional trackers are added (Phase 2), this module
// will read `job.trackerType` and dispatch to the appropriate adapter.
//
// The key difference from linear-worker:
// - executionMode is 'task_worker' instead of 'linear_worker'
// - job.trackerType determines which adapter to use (defaults to 'linear')

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

  // Phase 1: All trackers use the Linear worker pipeline.
  // Phase 2 will add tracker-specific observation/action builders.
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
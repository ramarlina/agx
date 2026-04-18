import { logger } from '@/lib/logger';
import type { PromptJob, PromptRun } from './types';
import type { PromptJobStore } from './store';
import { computeNextRun, parseCadence } from './cron';

export interface PollResult {
  queued: PromptRun[];
  skipped: Array<{ jobId: string; reason: string }>;
}

export async function pollDueJobs(store: PromptJobStore, now: number = Date.now()): Promise<PollResult> {
  // Reap runs stuck in 'running' for > 30 minutes so overlap-skip doesn't block forever
  const reaped = await store.reapStaleRuns();
  if (reaped > 0) {
    logger.info(`[prompt-jobs] reaped ${reaped} stale run(s)`);
  }

  // Heal active jobs with null nextRunAt
  const allJobs = store.listJobs({ state: 'active' as any });
  for (const job of allJobs) {
    if (job.nextRunAt === null) {
      const cronExpr = job.cronExpr || parseCadence(job.cadence)?.cronExpr || '';
      if (!cronExpr) continue;
      const nextRunAt = computeNextRunAt({ cronExpr }, now);
      if (nextRunAt) store.updateJob(job.id, { nextRunAt });
    }
  }

  const dueJobs = store.getDueJobs(now);
  const queued: PromptRun[] = [];
  const skipped: Array<{ jobId: string; reason: string }> = [];

  for (const job of dueJobs) {
    if (job.overlapPolicy === 'skip' && store.hasRunningRun(job.id)) {
      skipped.push({ jobId: job.id, reason: 'overlap_skip' });
      const nextRunAt = computeNextRunAt(job, now);
      store.updateJob(job.id, { nextRunAt });
      continue;
    }

    // Handle catch-up policy for missed runs
    const missedCount = countMissedOccurrences(job, now);

    if (job.catchUpPolicy === 'skip' && missedCount > 1) {
      // Skip all missed, just advance to next future tick
      skipped.push({ jobId: job.id, reason: `catch_up_skip (${missedCount} missed)` });
      const nextRunAt = computeNextRunAt(job, now);
      store.updateJob(job.id, { nextRunAt, lastRunAt: now });
      continue;
    }

    if (job.catchUpPolicy === 'replay_all' && missedCount > 1) {
      // Queue one run per missed occurrence
      for (let i = 0; i < missedCount; i++) {
        const run = store.createRun(job.id);
        queued.push(run);
      }
    } else {
      // fire_once (default): just run once regardless of how many were missed
      const run = store.createRun(job.id);
      queued.push(run);
    }

    const nextRunAt = computeNextRunAt(job, now);
    store.updateJob(job.id, { nextRunAt, lastRunAt: now });
  }

  return { queued, skipped };
}

/** Compute next run based on trigger type */
function computeNextRunAt(job: { cronExpr: string }, now: number): number | null {
  return computeNextRun(job.cronExpr, now);
}

/** Count how many cron occurrences were missed between lastRunAt/nextRunAt and now */
function countMissedOccurrences(job: PromptJob, now: number): number {
  if (!job.nextRunAt) return 1;

  let count = 0;
  let cursor = job.nextRunAt;
  const maxCount = 100; // safety cap

  while (cursor <= now && count < maxCount) {
    count++;
    const next = computeNextRun(job.cronExpr, cursor);
    if (!next || next <= cursor) break;
    cursor = next;
  }

  return Math.max(1, count);
}

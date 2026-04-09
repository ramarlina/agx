import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pragmaSet } from '@/lib/sqlite-compat';
import { PromptJobStore } from '@/src/prompt-scheduler/store';
import { pollDueJobs } from '@/src/prompt-scheduler/engine';
import type { CreatePromptJobInput } from '@/src/prompt-scheduler/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  pragmaSet(db, 'foreign_keys = ON');

  const schema1 = fs.readFileSync(
    path.join(process.cwd(), 'db/sqlite/001_agx_board_schema.sql'),
    'utf8',
  );
  const schema2 = fs.readFileSync(
    path.join(process.cwd(), 'db/sqlite/002_prompt_scheduler_schema.sql'),
    'utf8',
  );

  db.exec(schema1);
  db.exec(schema2);

  return db;
}

const VALID_CRON = '*/5 * * * *'; // every 5 minutes

function makeInput(overrides: Partial<CreatePromptJobInput> = {}): CreatePromptJobInput {
  return {
    name: 'Test Job',
    prompt: 'Do something useful',
    provider: 'claude',
    cadence: VALID_CRON,
    overlapPolicy: 'skip',
    ...overrides,
  };
}

/** Force a job's next_run_at to be in the past so it appears due */
function setDue(store: PromptJobStore, jobId: string, pastMs = Date.now() - 10_000): void {
  store.updateJob(jobId, { nextRunAt: pastMs });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pollDueJobs', () => {
  let db: DatabaseSync;
  let store: PromptJobStore;
  let automationsDir: string;

  beforeEach(() => {
    automationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-automations-engine-'));
    process.env.AGX_AUTOMATIONS_DIR = automationsDir;
    db = createTestDb();
    store = new PromptJobStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(automationsDir, { recursive: true, force: true });
    delete process.env.AGX_AUTOMATIONS_DIR;
  });

  it('creates runs for due jobs and advances nextRunAt', () => {
    const now = Date.now();
    const job = store.createJob(makeInput());
    setDue(store, job.id, now - 10_000);

    const result = pollDueJobs(store, now);

    expect(result.queued).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.queued[0].jobId).toBe(job.id);
    expect(result.queued[0].status).toBe('queued');

    // nextRunAt should have been advanced into the future
    const updated = store.getJob(job.id);
    expect(updated?.nextRunAt).toBeGreaterThan(now);

    // lastRunAt should be set to now
    expect(updated?.lastRunAt).toBe(now);
  });

  it('skips jobs with overlap_policy=skip when a run is active', () => {
    const now = Date.now();
    const job = store.createJob(makeInput({ overlapPolicy: 'skip' }));
    setDue(store, job.id, now - 10_000);

    // Create a running run to simulate overlap
    const existingRun = store.createRun(job.id);
    store.updateRun(existingRun.id, { status: 'running' });

    const result = pollDueJobs(store, now);

    expect(result.queued).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].jobId).toBe(job.id);
    expect(result.skipped[0].reason).toBe('overlap_skip');

    // nextRunAt should still be advanced even when skipped
    const updated = store.getJob(job.id);
    expect(updated?.nextRunAt).toBeGreaterThan(now);
  });

  it('queues jobs with overlap_policy=allow even when a run is active', () => {
    const now = Date.now();
    const job = store.createJob(makeInput({ overlapPolicy: 'allow' }));
    setDue(store, job.id, now - 10_000);

    // Create a running run to simulate overlap
    const existingRun = store.createRun(job.id);
    store.updateRun(existingRun.id, { status: 'running' });

    const result = pollDueJobs(store, now);

    expect(result.queued).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.queued[0].jobId).toBe(job.id);

    // nextRunAt advanced, lastRunAt set
    const updated = store.getJob(job.id);
    expect(updated?.nextRunAt).toBeGreaterThan(now);
    expect(updated?.lastRunAt).toBe(now);
  });

  it('returns empty when no jobs are due', () => {
    const now = Date.now();

    // Create a job with next_run_at in the future
    const job = store.createJob(makeInput());
    store.updateJob(job.id, { nextRunAt: now + 9_999_999 });

    const result = pollDueJobs(store, now);

    expect(result.queued).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('handles multiple due jobs in one poll', () => {
    const now = Date.now();
    const jobA = store.createJob(makeInput({ name: 'Job A' }));
    const jobB = store.createJob(makeInput({ name: 'Job B' }));
    setDue(store, jobA.id, now - 20_000);
    setDue(store, jobB.id, now - 10_000);

    const result = pollDueJobs(store, now);

    expect(result.queued).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    const queuedJobIds = result.queued.map((r) => r.jobId);
    expect(queuedJobIds).toContain(jobA.id);
    expect(queuedJobIds).toContain(jobB.id);
  });
});

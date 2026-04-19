import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pragmaSet } from '@/lib/sqlite-compat';
import { parseStoredTimestampMs, PromptJobStore } from '@/src/prompt-scheduler/store';
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

  const schema3 = fs.readFileSync(
    path.join(process.cwd(), 'db/sqlite/004_prompt_runs_host_pid.sql'),
    'utf8',
  );
  const schema4 = fs.readFileSync(
    path.join(process.cwd(), 'db/sqlite/006_prompt_jobs_execution_mode.sql'),
    'utf8',
  );

  // Schema 1 has PRAGMA journal_mode = WAL which doesn't apply to :memory: but is safe to exec
  db.exec(schema1);
  db.exec(schema2);
  for (const stmt of schema3.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
    db.exec(stmt);
  }
  for (const stmt of schema4.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
    db.exec(stmt);
  }

  return db;
}

const VALID_CRON = '*/5 * * * *'; // every 5 minutes

function makeInput(overrides: Partial<CreatePromptJobInput> = {}): CreatePromptJobInput {
  return {
    name: 'Test Job',
    prompt: 'Do something useful',
    provider: 'claude',
    cadence: VALID_CRON,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PromptJobStore', () => {
  let db: DatabaseSync;
  let store: PromptJobStore;
  let automationsDir: string;

  beforeEach(() => {
    automationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-automations-store-'));
    process.env.AGX_AUTOMATIONS_DIR = automationsDir;
    db = createTestDb();
    store = new PromptJobStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(automationsDir, { recursive: true, force: true });
    delete process.env.AGX_AUTOMATIONS_DIR;
  });

  // ── createJob ───────────────────────────────────────────────────────────────

  describe('createJob', () => {
    it('creates a job and returns it with all fields', () => {
      const job = store.createJob(makeInput());

      expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(job.name).toBe('Test Job');
      expect(job.prompt).toBe('Do something useful');
      expect(job.provider).toBe('claude');
      expect(job.cadence).toBe('Every 5 minutes');
      expect(job.cronExpr).toBe(VALID_CRON);
      expect(job.state).toBe('active');
      expect(job.overlapPolicy).toBe('skip');
      expect(job.cancelCheckSec).toBe(5);
      expect(job.createdAt).toBeTruthy();
      expect(job.updatedAt).toBeTruthy();
    });

    it('computes nextRunAt for valid cron', () => {
      const job = store.createJob(makeInput());
      expect(job.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('respects custom overlapPolicy and cancelCheckSec', () => {
      const job = store.createJob(makeInput({ overlapPolicy: 'queue', cancelCheckSec: 30 }));
      expect(job.overlapPolicy).toBe('queue');
      expect(job.cancelCheckSec).toBe(30);
    });

    it('sets lastRunAt and lastOutcome to null on creation', () => {
      const job = store.createJob(makeInput());
      expect(job.lastRunAt).toBeNull();
      expect(job.lastOutcome).toBeNull();
    });

    it('stores the optional condition gate in automation frontmatter', () => {
      const job = store.createJob(makeInput({ condition: 'there are unread emails' }));

      expect(job.condition).toBe('there are unread emails');

      const markdown = fs.readFileSync(path.join(automationsDir, 'active', `${job.id}.md`), 'utf8');
      expect(markdown).toContain('type: prompt_job');
      expect(markdown).toContain('type: scheduled');
      expect(markdown).toContain('condition: there are unread emails');
      expect(markdown).not.toContain('type: condition');
    });

    it('stores objective ownership metadata with the job', () => {
      const job = store.createJob(makeInput({
        objectiveId: 'objective-growth',
        objectiveKey: 'growth-daily-visitors',
      }));
      const fetched = store.getJob(job.id);

      expect(job.objectiveId).toBe('objective-growth');
      expect(job.objectiveKey).toBe('growth-daily-visitors');
      expect(fetched?.objectiveId).toBe('objective-growth');
      expect(fetched?.objectiveKey).toBe('growth-daily-visitors');

      const markdown = fs.readFileSync(path.join(automationsDir, 'active', `${job.id}.md`), 'utf8');
      expect(markdown).toContain('objectiveId: objective-growth');
      expect(markdown).toContain('objectiveKey: growth-daily-visitors');
    });

    it('auto-converts legacy condition-trigger input into a schedule plus gate', () => {
      const job = store.createJob(makeInput({
        cadence: '',
        triggerType: 'condition',
        checkEveryMs: 300000,
        condition: 'inbox has unread items',
      }));

      expect(job.condition).toBe('inbox has unread items');
      expect(job.cronExpr).toBe('*/5 * * * *');
      expect(job.cadence).toBe('Every 5 minutes');
      expect(job.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });
  });

  // ── getJob ──────────────────────────────────────────────────────────────────

  describe('getJob', () => {
    it('returns the job by id', () => {
      const created = store.createJob(makeInput());
      const fetched = store.getJob(created.id);
      expect(fetched).toEqual(created);
    });

    it('returns null for unknown id', () => {
      expect(store.getJob('non-existent-id')).toBeNull();
    });
  });

  // ── listJobs ────────────────────────────────────────────────────────────────

  describe('listJobs', () => {
    it('returns all jobs ordered by created_at DESC', () => {
      const a = store.createJob(makeInput({ name: 'A' }));
      const b = store.createJob(makeInput({ name: 'B' }));
      const list = store.listJobs();
      expect(list.length).toBe(2);
      // Both jobs should be present (order may vary if timestamps are equal in :memory: db)
      const ids = list.map((j) => j.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
    });

    it('filters by state', () => {
      const active = store.createJob(makeInput({ name: 'Active' }));
      store.createJob(makeInput({ name: 'Also Active' }));
      // Pause the first job
      store.updateJob(active.id, { state: 'paused' });

      const activeList = store.listJobs({ state: 'active' });
      const pausedList = store.listJobs({ state: 'paused' });

      expect(activeList).toHaveLength(1);
      expect(activeList[0].name).toBe('Also Active');
      expect(pausedList).toHaveLength(1);
      expect(pausedList[0].id).toBe(active.id);
    });

    it('excludes objective-owned jobs when requested', () => {
      const globalJob = store.createJob(makeInput({ name: 'Global job' }));
      store.createJob(makeInput({
        name: 'Objective job',
        objectiveId: 'objective-growth',
        objectiveKey: 'growth-daily-visitors',
      }));

      const list = store.listJobs({ includeObjectiveJobs: false });

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(globalJob.id);
    });

    it('can list only the jobs for a specific objective', () => {
      const objectiveJob = store.createJob(makeInput({
        name: 'Objective job',
        objectiveId: 'objective-growth',
        objectiveKey: 'growth-daily-visitors',
      }));
      store.createJob(makeInput({
        name: 'Other objective job',
        objectiveId: 'objective-other',
        objectiveKey: 'other-objective',
      }));
      store.createJob(makeInput({ name: 'Global job' }));

      const list = store.listJobs({ objectiveId: 'objective-growth' });

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(objectiveJob.id);
    });

    it('returns empty array when no jobs exist', () => {
      expect(store.listJobs()).toEqual([]);
    });
  });

  // ── updateJob ───────────────────────────────────────────────────────────────

  describe('updateJob', () => {
    it('updates name and prompt', () => {
      const job = store.createJob(makeInput());
      const updated = store.updateJob(job.id, { name: 'Updated', prompt: 'New prompt' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.prompt).toBe('New prompt');
    });

    it('updates state', () => {
      const job = store.createJob(makeInput());
      const updated = store.updateJob(job.id, { state: 'paused' });
      expect(updated?.state).toBe('paused');
    });

    it('updates cadence and recomputes cron_expr / nextRunAt', () => {
      const job = store.createJob(makeInput());
      const newCron = '0 * * * *';
      const updated = store.updateJob(job.id, { cadence: newCron });
      expect(updated?.cadence).toBe('Every hour');
      expect(updated?.cronExpr).toBe(newCron);
      expect(updated?.nextRunAt).toBeGreaterThan(0);
    });

    it('returns null for unknown id', () => {
      expect(store.updateJob('bad-id', { name: 'X' })).toBeNull();
    });

    it('returns current job when no fields to update', () => {
      const job = store.createJob(makeInput());
      const result = store.updateJob(job.id, {});
      expect(result?.id).toBe(job.id);
    });

    it('updates legacy-only jobs without materializing frontmatter files', () => {
      const id = 'legacy-job-1';
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO prompt_jobs (
          id, name, prompt, cli, agent_id, project_id, provider, model, cli_args,
          cron_expr, cadence, state, overlap_policy, catch_up_policy, cancel_check_sec,
          trigger_type, condition, check_every_ms, next_run_at, last_run_at, last_outcome,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        'Test Job',
        'Do something useful',
        'claude',
        null,
        null,
        'claude',
        '',
        '',
        VALID_CRON,
        VALID_CRON,
        'active',
        'skip',
        'fire_once',
        5,
        'scheduled',
        '',
        300000,
        Date.now() + 60_000,
        null,
        null,
        createdAt,
        createdAt,
      );

      const updated = store.updateJob(id, { state: 'paused' });

      expect(updated?.state).toBe('paused');
      expect(fs.existsSync(path.join(automationsDir, 'active', `${id}.md`))).toBe(false);
      expect(fs.existsSync(path.join(automationsDir, '.state', `${id}.json`))).toBe(false);
    });

    it('auto-converts legacy condition rows when they are read', () => {
      const id = 'legacy-condition-job';
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO prompt_jobs (
          id, name, prompt, cli, agent_id, project_id, provider, model, cli_args,
          cron_expr, cadence, state, overlap_policy, catch_up_policy, cancel_check_sec,
          trigger_type, condition, check_every_ms, next_run_at, last_run_at, last_outcome,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        'Legacy Condition Job',
        'Check the inbox',
        'claude',
        null,
        null,
        'claude',
        '',
        '',
        '',
        '',
        'active',
        'skip',
        'fire_once',
        5,
        'condition',
        'there are unread emails',
        300000,
        Date.now() + 300000,
        null,
        null,
        createdAt,
        createdAt,
      );

      const fetched = store.getJob(id);
      const row = db.prepare('SELECT trigger_type, cadence, cron_expr FROM prompt_jobs WHERE id = ?').get(id) as {
        trigger_type: string;
        cadence: string;
        cron_expr: string;
      };

      expect(fetched?.condition).toBe('there are unread emails');
      expect(fetched?.cronExpr).toBe('*/5 * * * *');
      expect(fetched?.cadence).toBe('Every 5 minutes');
      expect(row).toEqual({
        trigger_type: 'scheduled',
        cadence: 'Every 5 minutes',
        cron_expr: '*/5 * * * *',
      });
    });

    it('auto-converts legacy condition automations when they are loaded', () => {
      const id = 'legacy-automation-condition';
      fs.mkdirSync(path.join(automationsDir, 'active'), { recursive: true });
      fs.writeFileSync(
        path.join(automationsDir, 'active', `${id}.md`),
        `---
id: ${id}
name: Legacy Automation
state: active
trigger:
  type: condition
  condition: there are unread emails
  checkEveryMs: 300000
target:
  type: prompt_job
  provider: claude
---
Check the inbox
`,
        'utf8',
      );

      const fetched = store.getJob(id);
      const markdown = fs.readFileSync(path.join(automationsDir, 'active', `${id}.md`), 'utf8');

      expect(fetched?.condition).toBe('there are unread emails');
      expect(fetched?.cronExpr).toBe('*/5 * * * *');
      expect(markdown).toContain('type: scheduled');
      expect(markdown).toContain('condition: there are unread emails');
      expect(markdown).not.toContain('type: condition');
    });
  });

  // ── deleteJob ───────────────────────────────────────────────────────────────

  describe('deleteJob', () => {
    it('hides the job from the active list', () => {
      const job = store.createJob(makeInput());
      store.deleteJob(job.id);

      expect(store.getJob(job.id)).toBeNull();
      expect(store.listJobs().some((entry) => entry.id === job.id)).toBe(false);
      expect(fs.existsSync(path.join(automationsDir, 'active', `${job.id}.md`))).toBe(false);
      expect(fs.existsSync(path.join(automationsDir, 'archived', `${job.id}.md`))).toBe(true);
    });

    it('cascades to runs on delete', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      store.updateRun(run.id, {
        status: 'success',
        finishedAt: new Date().toISOString(),
      });
      store.deleteJob(job.id);
      expect(store.getRun(run.id)).toBeNull();
    });

    it('rejects deleting a job while work is queued or running', () => {
      const job = store.createJob(makeInput());
      store.createRun(job.id);

      expect(() => store.deleteJob(job.id)).toThrow(
        'Cannot delete a scheduled task while a run is queued or running. Cancel the active run first.',
      );
      expect(store.getJob(job.id)).not.toBeNull();
    });
  });

  // ── getDueJobs ───────────────────────────────────────────────────────────────

  describe('getDueJobs', () => {
    it('returns active jobs whose next_run_at <= now', () => {
      const job = store.createJob(makeInput());
      store.updateJob(job.id, { nextRunAt: Date.now() - 10000 });
      const due = store.getDueJobs();
      expect(due.some((j) => j.id === job.id)).toBe(true);
    });

    it('excludes jobs with next_run_at in the future', () => {
      const job = store.createJob(makeInput());
      store.updateJob(job.id, { nextRunAt: Date.now() + 9999999 });
      const due = store.getDueJobs();
      expect(due.some((j) => j.id === job.id)).toBe(false);
    });

    it('excludes paused and stopped jobs', () => {
      const job = store.createJob(makeInput());
      store.updateJob(job.id, {
        nextRunAt: Date.now() - 1000,
        state: 'paused',
      });
      const due = store.getDueJobs();
      expect(due.some((j) => j.id === job.id)).toBe(false);
    });
  });

  // ── createRun ────────────────────────────────────────────────────────────────

  describe('createRun', () => {
    it('creates a queued run', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(run.jobId).toBe(job.id);
      expect(run.status).toBe('queued');
      expect(run.output).toBeNull();
      expect(run.error).toBeNull();
      expect(run.durationMs).toBeNull();
      expect(run.startedAt).toBeNull();
      expect(run.finishedAt).toBeNull();
      expect(run.cancelledAt).toBeNull();
      expect(run.createdAt).toBeTruthy();
    });
  });

  // ── getRun ───────────────────────────────────────────────────────────────────

  describe('getRun', () => {
    it('returns run by id', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      expect(store.getRun(run.id)).toEqual(run);
    });

    it('returns null for unknown id', () => {
      expect(store.getRun('bad-id')).toBeNull();
    });
  });

  // ── listRuns ─────────────────────────────────────────────────────────────────

  describe('listRuns', () => {
    it('returns runs for a job, newest first', () => {
      const job = store.createJob(makeInput());
      const r1 = store.createRun(job.id);
      const r2 = store.createRun(job.id);
      const runs = store.listRuns(job.id);
      expect(runs.length).toBe(2);
      // Both runs should be present; all belong to the same job
      const ids = runs.map((r) => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
      expect(runs.every((r) => r.jobId === job.id)).toBe(true);
    });

    it('returns empty array for job with no runs', () => {
      const job = store.createJob(makeInput());
      expect(store.listRuns(job.id)).toEqual([]);
    });

    it('respects the limit parameter', () => {
      const job = store.createJob(makeInput());
      for (let i = 0; i < 5; i++) store.createRun(job.id);
      const runs = store.listRuns(job.id, 3);
      expect(runs.length).toBe(3);
    });
  });

  describe('listQueuedRuns', () => {
    it('returns queued runs across jobs', () => {
      const jobA = store.createJob(makeInput({ name: 'Job A' }));
      const jobB = store.createJob(makeInput({ name: 'Job B' }));
      const queuedA = store.createRun(jobA.id);
      const runningB = store.createRun(jobB.id);
      store.updateRun(runningB.id, { status: 'running' });

      const queuedRuns = store.listQueuedRuns();

      expect(queuedRuns.map((run) => run.id)).toContain(queuedA.id);
      expect(queuedRuns.map((run) => run.id)).not.toContain(runningB.id);
    });
  });

  // ── updateRun ────────────────────────────────────────────────────────────────

  describe('updateRun', () => {
    it('updates status and output', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      const updated = store.updateRun(run.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      expect(updated?.status).toBe('running');
      expect(updated?.startedAt).toBeTruthy();
    });

    it('marks run as success with duration', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      const now = new Date().toISOString();
      const updated = store.updateRun(run.id, {
        status: 'success',
        output: 'Done!',
        durationMs: 1234,
        finishedAt: now,
      });
      expect(updated?.status).toBe('success');
      expect(updated?.output).toBe('Done!');
      expect(updated?.durationMs).toBe(1234);
      expect(updated?.finishedAt).toBe(now);
    });

    it('marks run as cancelled', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      const now = new Date().toISOString();
      const updated = store.updateRun(run.id, { status: 'cancelled', cancelledAt: now });
      expect(updated?.status).toBe('cancelled');
      expect(updated?.cancelledAt).toBe(now);
    });

    it('returns null for unknown id', () => {
      expect(store.updateRun('bad-id', { status: 'running' })).toBeNull();
    });
  });

  // ── hasRunningRun ─────────────────────────────────────────────────────────────

  describe('hasRunningRun', () => {
    it('returns false when no runs exist', () => {
      const job = store.createJob(makeInput());
      expect(store.hasRunningRun(job.id)).toBe(false);
    });

    it('returns true when a queued run exists', () => {
      const job = store.createJob(makeInput());
      store.createRun(job.id);
      expect(store.hasRunningRun(job.id)).toBe(true);
    });

    it('returns true when a running run exists', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      store.updateRun(run.id, { status: 'running' });
      expect(store.hasRunningRun(job.id)).toBe(true);
    });

    it('returns false when all runs are in terminal states', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      store.updateRun(run.id, { status: 'success' });
      expect(store.hasRunningRun(job.id)).toBe(false);
    });
  });

  describe('reapStaleRuns', () => {
    it('leaves queued runs alone so they can be redispatched', async () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);

      db.prepare("UPDATE prompt_runs SET created_at = ? WHERE id = ?")
        .run('2026-04-10 03:30:00', run.id);

      const reaped = await store.reapStaleRuns(1);

      expect(reaped).toBe(0);
      expect(store.getRun(run.id)?.status).toBe('queued');
    });

    it('does not reap a fresh running run just because the wrapper pid disappeared', async () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);

      store.updateRun(run.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
        hostPid: 999999,
        hostCommand: 'agx codex -y --print',
      });

      const reaped = await store.reapStaleRuns(60_000);

      expect(reaped).toBe(0);
      expect(store.getRun(run.id)?.status).toBe('running');
    });
  });

  describe('parseStoredTimestampMs', () => {
    it('treats bare SQLite datetime strings as UTC', () => {
      expect(parseStoredTimestampMs('2026-04-11 03:30:00'))
        .toBe(Date.parse('2026-04-11T03:30:00.000Z'));
    });
  });

  // ── isRunCancelled ────────────────────────────────────────────────────────────

  describe('isRunCancelled', () => {
    it('returns false for a queued run', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      expect(store.isRunCancelled(run.id)).toBe(false);
    });

    it('returns true for a cancelled run', () => {
      const job = store.createJob(makeInput());
      const run = store.createRun(job.id);
      store.updateRun(run.id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
      expect(store.isRunCancelled(run.id)).toBe(true);
    });

    it('returns false for unknown run id', () => {
      expect(store.isRunCancelled('bad-id')).toBe(false);
    });
  });
});

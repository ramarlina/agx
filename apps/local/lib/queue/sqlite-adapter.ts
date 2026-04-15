import type { DatabaseSync } from "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } =
  process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import { pragmaAll, transaction } from "../sqlite-compat";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import os from "os";
import { QueueAdapter, QueueOptions, WorkerOptions, Job } from "./adapter";
import { validateSQLiteEnvironment, REQUIRED_PRAGMAS } from "../startup";
import { WriteRateMonitor, WRITE_RATE_SAMPLE_WINDOW_MS } from "../limits";
import { QUEUE_POLL_INTERVAL_MS } from "../constants/timing";
import { writeDebugLog } from "../debug-log";

const AGX_DATA_DIR = process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx");
const DEFAULT_STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

function getStaleJobTimeoutMs(): number {
  const raw = Number(process.env.AGX_QUEUE_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_JOB_TIMEOUT_MS;
}

interface SQLiteJobRow {
  id: string;
  queue: string;
  data: string;
  status: "pending" | "active" | "completed" | "failed" | "retry";
  created_at: number;
  start_after: number;
  started_at: number | null;
  completed_at: number | null;
  worker_id: string | null;
  retry_count: number;
  retry_limit: number;
  priority: number;
  error: string | null;
}

export class SQLiteQueueAdapter implements QueueAdapter {
  private db: DatabaseSync;
  private workers: Map<string, { handler: Function; options: WorkerOptions; running: boolean }> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private writeRateInterval: NodeJS.Timeout | null = null;
  private writeMonitor = new WriteRateMonitor();
  private workerId: string;

  constructor(dbPath?: string) {
    this.workerId = uuidv4();
    const finalPath = dbPath || process.env.SQLITE_QUEUE_PATH || path.join(AGX_DATA_DIR, "agx-queue.db");

    // Ensure directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSyncCtor(finalPath);

    // Apply contract PRAGMAs and validate environment
    const errors = validateSQLiteEnvironment(this.db, finalPath);
    if (errors.length > 0) {
      const msgs = errors.map((e) => e.message).join("; ");
      console.error(`[SQLiteQueueAdapter] Startup validation failed: ${msgs}`);
      // Log but don't throw — the API status endpoint will surface these to the UI
    }
  }

  async start(): Promise<void> {
    this.initSchema();
    this.startPolling();
  }

  async stop(): Promise<void> {
    this.stopPolling();
    this.db.close();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agx_jobs (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'completed', 'failed', 'retry')),
        created_at INTEGER NOT NULL,
        start_after INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        completed_at INTEGER,
        failed_at INTEGER,
        worker_id TEXT,
        retry_count INTEGER DEFAULT 0,
        retry_limit INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_fetch ON agx_jobs (queue, status, start_after, priority DESC, created_at ASC);
    `);

    // Migrate: add columns that may be missing from older schemas
    const cols = pragmaAll(this.db, 'table_info(agx_jobs)') as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('failed_at')) {
      this.db.exec(`ALTER TABLE agx_jobs ADD COLUMN failed_at INTEGER`);
    }
    if (!colNames.has('error')) {
      this.db.exec(`ALTER TABLE agx_jobs ADD COLUMN error TEXT`);
    }
  }

  async send<T>(queue: string, data: T, options?: QueueOptions): Promise<string> {
    const id = uuidv4();
    const now = Date.now();
    const startAfter = options?.startAfter
      ? (options.startAfter instanceof Date ? options.startAfter.getTime() : options.startAfter)
      : now;

    const stmt = this.db.prepare(`
      INSERT INTO agx_jobs (
        id, queue, data, status, created_at, start_after, retry_limit, priority
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      queue,
      JSON.stringify(data),
      now,
      startAfter,
      options?.retryLimit ?? 3,
      options?.priority ?? 0
    );

    this.writeMonitor.record();
    writeDebugLog("queue.send", {
      queue,
      jobId: id,
      startAfter,
      retryLimit: options?.retryLimit ?? 3,
      priority: options?.priority ?? 0,
      data,
    });
    return id;
  }

  async work<T>(
    queue: string,
    handler: (jobs: Job<T>[]) => Promise<void>,
    options?: WorkerOptions
  ): Promise<void> {
    writeDebugLog("queue.worker.register", {
      queue,
      batchSize: options?.batchSize ?? 1,
      pollInterval: options?.pollInterval ?? null,
      workerId: this.workerId,
    });
    this.workers.set(queue, {
      handler,
      options: options || {},
      running: true,
    });
  }

  private startPolling() {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(() => this.poll(), QUEUE_POLL_INTERVAL_MS);
    // Periodic write-rate check (see docs/LIMITS.md)
    this.writeRateInterval = setInterval(() => this.writeMonitor.check(), WRITE_RATE_SAMPLE_WINDOW_MS);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.writeRateInterval) {
      clearInterval(this.writeRateInterval);
      this.writeRateInterval = null;
    }
  }

  private poll() {
    for (const [queue, worker] of this.workers) {
      if (!worker.running) continue;
      this.processQueue(queue, worker);
    }
  }

  private processQueue(queue: string, worker: { handler: Function; options: WorkerOptions }) {
    const batchSize = worker.options.batchSize || 1;
    const now = Date.now();
    const staleBefore = now - getStaleJobTimeoutMs();

    // Transactional claim
    const jobs = transaction(this.db, () => {
      const reapedJobs = this.reapStaleJobs(queue, now, staleBefore);
      if (reapedJobs.length > 0) {
        writeDebugLog("queue.reap_stale", {
          queue,
          workerId: this.workerId,
          staleBefore,
          jobs: reapedJobs,
        });
      }

      // 1. Find candidates
      const candidates = this.db.prepare(`
        SELECT id, data FROM agx_jobs
        WHERE queue = ?
          AND (status = 'pending' OR status = 'retry')
          AND start_after <= ?
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `).all(queue, now, batchSize) as { id: string; data: string }[];

      if (candidates.length === 0) return [];

      // 2. Mark active
      const ids = candidates.map(c => c.id);
      const markActive = this.db.prepare(`
        UPDATE agx_jobs
        SET status = 'active', started_at = ?, worker_id = ?
        WHERE id = ?
      `);

      for (const id of ids) {
        markActive.run(now, this.workerId, id);
      }

      return candidates.map(c => ({
        id: c.id,
        name: queue,
        data: JSON.parse(c.data)
      }));
    });

    if (jobs.length > 0) {
      writeDebugLog("queue.claim", {
        queue,
        workerId: this.workerId,
        jobIds: jobs.map((job) => job.id),
      });
      // Execute handler
      // Note: We don't await here to avoid blocking the poll loop, 
      // but in single-threaded Node, we are effectively blocking if the handler is sync-heavy.
      // If async, we should probably track active promises to control concurrency.
      // For simplicity in this adapter, we just fire and forget the promise, 
      // but we need to handle completion/failure to update DB.

      this.executeJobs(jobs, worker.handler);
    }
  }

  private async executeJobs(jobs: Job<any>[], handler: Function) {
    try {
      await handler(jobs);
      // Success
      this.completeJobs(jobs.map(j => j.id));
      writeDebugLog("queue.complete", {
        jobIds: jobs.map((job) => job.id),
      });
    } catch (err: any) {
      // Failure (batch failure — all jobs in the batch fail together)
      this.failJobs(jobs.map(j => j.id), err.message || String(err));
      writeDebugLog("queue.fail", {
        jobIds: jobs.map((job) => job.id),
        error: err,
      });
    }
  }

  private completeJobs(ids: string[]) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agx_jobs
      SET status = 'completed', completed_at = ?, worker_id = NULL
      WHERE id = ?
    `);
    transaction(this.db, () => {
      for (const id of ids) stmt.run(now, id);
    });
  }

  private failJobs(ids: string[], error: string) {
    const now = Date.now();
    // Check retry limits
    const stmt = this.db.prepare(`
      SELECT id, retry_count, retry_limit FROM agx_jobs WHERE id = ?
    `);

    const updateRetry = this.db.prepare(`
      UPDATE agx_jobs
      SET status = 'retry', retry_count = retry_count + 1, 
          start_after = ? + (retry_count * 1000 * 2), -- Exponential backoff (kinda)
          started_at = NULL,
          worker_id = NULL,
          error = ?
      WHERE id = ?
    `);

    const updateFailed = this.db.prepare(`
      UPDATE agx_jobs
      SET status = 'failed', failed_at = ?, started_at = NULL, worker_id = NULL, error = ?
      WHERE id = ?
    `);

    transaction(this.db, () => {
      for (const id of ids) {
        const job = stmt.get(id) as unknown as SQLiteJobRow;
        if (job && job.retry_count < job.retry_limit) {
          // Retry
          // Simple backoff: 2s * retry_count
          const backoff = (job.retry_count + 1) * 2000;
          updateRetry.run(now + backoff, error, id);
        } else {
          // Fatal
          updateFailed.run(now, error, id);
        }
      }
    });
  }

  private reapStaleJobs(queue: string, now: number, staleBefore: number): Array<{
    id: string;
    fromStatus: "active";
    toStatus: "retry" | "failed";
    retryCount: number;
  }> {
    const staleJobs = this.db.prepare(`
      SELECT id, retry_count, retry_limit
      FROM agx_jobs
      WHERE queue = ?
        AND status = 'active'
        AND started_at IS NOT NULL
        AND started_at <= ?
      ORDER BY started_at ASC
    `).all(queue, staleBefore) as Array<Pick<SQLiteJobRow, "id" | "retry_count" | "retry_limit">>;

    if (staleJobs.length === 0) return [];

    const updateRetry = this.db.prepare(`
      UPDATE agx_jobs
      SET status = 'retry',
          retry_count = retry_count + 1,
          start_after = ?,
          started_at = NULL,
          worker_id = NULL,
          error = ?
      WHERE id = ?
    `);
    const updateFailed = this.db.prepare(`
      UPDATE agx_jobs
      SET status = 'failed',
          failed_at = ?,
          started_at = NULL,
          worker_id = NULL,
          error = ?
      WHERE id = ?
    `);

    const reaped: Array<{
      id: string;
      fromStatus: "active";
      toStatus: "retry" | "failed";
      retryCount: number;
    }> = [];

    for (const job of staleJobs) {
      const error = `Job exceeded active timeout of ${getStaleJobTimeoutMs()}ms`;
      if (job.retry_count < job.retry_limit) {
        updateRetry.run(now, error, job.id);
        reaped.push({
          id: job.id,
          fromStatus: "active",
          toStatus: "retry",
          retryCount: job.retry_count + 1,
        });
      } else {
        updateFailed.run(now, error, job.id);
        reaped.push({
          id: job.id,
          fromStatus: "active",
          toStatus: "failed",
          retryCount: job.retry_count,
        });
      }
    }

    return reaped;
  }
}

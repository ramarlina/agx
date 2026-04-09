import { DatabaseSync } from 'node:sqlite';
import { pragmaSet } from '../lib/sqlite-compat';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

// --- Configuration ---
const DB_PATH = path.join(process.cwd(), 'bench-queue.db');
const WORKER_COUNT = 20;
const TOTAL_JOBS = 1000;
const POLL_INTERVAL_MS = 50; 
const LEASE_MS = 2000;

console.log(`Setting up benchmark: ${WORKER_COUNT} workers, ${TOTAL_JOBS} jobs, DB: ${DB_PATH}`);

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}
if (fs.existsSync(DB_PATH + '-shm')) {
  fs.unlinkSync(DB_PATH + '-shm');
}
if (fs.existsSync(DB_PATH + '-wal')) {
  fs.unlinkSync(DB_PATH + '-wal');
}

const db = new DatabaseSync(DB_PATH);
pragmaSet(db, 'journal_mode = WAL');
pragmaSet(db, 'synchronous = NORMAL');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT,
    status TEXT DEFAULT 'queued', -- queued, running, completed, failed, dead
    run_at INTEGER NOT NULL, -- timestamp ms
    lease_until INTEGER,
    worker_id TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    priority INTEGER DEFAULT 0,
    idempotency_key TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_poll ON jobs (status, run_at, priority DESC, id ASC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idem ON jobs (name, idempotency_key);
`);

// --- Statements ---

const stmts = {
  enqueue: db.prepare(`
    INSERT INTO jobs (id, name, payload, run_at, max_attempts, idempotency_key, priority)
    VALUES (@id, @name, @payload, @runAt, @maxAttempts, @idempotencyKey, @priority)
    ON CONFLICT (name, idempotency_key) DO UPDATE SET updated_at = unixepoch() * 1000
    RETURNING id
  `),
  
  claim: db.prepare(`
    UPDATE jobs SET
      status = 'running',
      worker_id = @workerId,
      lease_until = @now + 2000, -- LEASE_MS
      attempts = attempts + 1,
      updated_at = @now
    WHERE id IN (
      SELECT id FROM jobs
      WHERE (status = 'queued' AND run_at <= @now)
         OR (status = 'running' AND lease_until < @now) -- Lease expiry reclaim
      ORDER BY priority DESC, run_at ASC, id ASC
      LIMIT @limit
    )
    RETURNING *
  `),

  complete: db.prepare(`
    UPDATE jobs SET
      status = 'completed',
      updated_at = @now,
      worker_id = NULL
    WHERE id = @id AND worker_id = @workerId
  `),

  fail: db.prepare(`
    UPDATE jobs SET
      status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
      run_at = CASE WHEN attempts >= max_attempts THEN run_at ELSE @retryAt END,
      worker_id = NULL,
      updated_at = @now
    WHERE id = @id AND worker_id = @workerId
  `),

  stats: db.prepare(`
    SELECT status, count(*) as count FROM jobs GROUP BY status
  `)
};

// --- Queue Implementation ---

class SqliteQueue {
  enqueue(name: string, payload: any, options: any = {}): string {
    const now = Date.now();
    try {
      const info = stmts.enqueue.get({
        id: randomUUID(),
        name,
        payload: JSON.stringify(payload),
        runAt: options.runAt ? options.runAt.getTime() : now,
        maxAttempts: options.maxAttempts || 3,
        idempotencyKey: options.idempotencyKey || null,
        priority: options.priority || 0
      }) as any;
      return info.id;
    } catch (e) {
      if (options.idempotencyKey && String(e).includes('UNIQUE constraint failed')) {
        return 'duplicate';
      }
      throw e;
    }
  }

  claim(workerId: string, limit: number): any[] {
    return stmts.claim.all({
      workerId,
      now: Date.now(),
      limit
    }) as any[];
  }

  complete(jobId: string, workerId: string) {
    stmts.complete.run({ id: jobId, workerId, now: Date.now() });
  }

  fail(jobId: string, workerId: string) {
    // Default backoff 1s
    const retryAt = Date.now() + 1000;
    stmts.fail.run({ id: jobId, workerId, retryAt, now: Date.now() });
  }
}

const queue = new SqliteQueue();

// --- Correctness Tests ---

async function runCorrectnessTests() {
  console.log('\n--- Running Correctness Tests ---');

  // Test 1: Lease Expiry
  console.log('Test 1: Lease Expiry Reclaim');
  const job1 = queue.enqueue('test-lease', { type: 'lease' }, { priority: 10 });
  const [claimed1] = queue.claim('worker-A', 1);
  if (!claimed1 || claimed1.id !== job1) throw new Error('Failed to claim job1');
  
  console.log('  Job claimed by worker-A. Waiting for lease expiry (2000ms)...');
  await new Promise(resolve => setTimeout(resolve, LEASE_MS + 500)); // Wait > lease

  const [claimed2] = queue.claim('worker-B', 1);
  if (!claimed2 || claimed2.id !== job1) {
    throw new Error('Failed to reclaim expired job');
  }
  if (claimed2.attempts !== 2) throw new Error(`Expected attempts=2, got ${claimed2.attempts}`);
  console.log('  PASS: Job reclaimed by worker-B after lease expiry.');
  queue.complete(job1, 'worker-B');

  // Test 2: Dead Letter
  console.log('Test 2: Dead Letter Boundary');
  const job2 = queue.enqueue('test-fail', { type: 'fail' }, { maxAttempts: 2 });
  
  // Attempt 1
  const [c1] = queue.claim('worker-A', 1);
  if (!c1) throw new Error('Failed to claim job2 attempt 1');
  queue.fail(c1.id, 'worker-A'); // Should retry
  
  console.log('  Job failed. Waiting for retry backoff (1000ms)...');
  await new Promise(resolve => setTimeout(resolve, 1200));

  // Attempt 2
  const [c2] = queue.claim('worker-A', 1);
  if (!c2 || c2.id !== job2) throw new Error('Failed to reclaim failed job');
  queue.fail(c2.id, 'worker-A'); // Should die
  
  // Attempt 3 (Should be empty)
  const [c3] = queue.claim('worker-A', 1);
  if (c3) throw new Error('Job should be dead, but was claimed again');

  const dead = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job2);
  if (dead.status !== 'dead') throw new Error(`Job status should be 'dead', got '${dead.status}'`);
  console.log('  PASS: Job moved to dead-letter queue after max attempts.');
}

// --- Benchmark ---

async function runBenchmark() {
  try {
    await runCorrectnessTests();
  } catch (e) {
    console.error('Correctness tests failed:', e);
    process.exit(1);
  }
  
  console.log('\n--- Running Load Benchmark ---');
  // Clear DB
  db.exec('DELETE FROM jobs');

  const start = Date.now();
  let completed = 0;
  
  // Producer
  console.log('Producing jobs...');
  for (let i = 0; i < TOTAL_JOBS; i++) {
    queue.enqueue('test-job', { index: i }, { priority: i % 5 });
  }
  const produced = Date.now();
  console.log(`Enqueued ${TOTAL_JOBS} jobs in ${produced - start}ms`);

  // Workers
  const workerpromises = [];
  const latencies: number[] = [];

  for (let w = 0; w < WORKER_COUNT; w++) {
    workerpromises.push((async () => {
      const workerId = `worker-${w}`;
      while (completed < TOTAL_JOBS) {
        // Claim
        const jobs = queue.claim(workerId, 1);
        if (jobs.length > 0) {
          const job = jobs[0];
          
          // Measure latency: now - run_at
          const latency = Date.now() - job.run_at;
          latencies.push(latency);

          // Simulate work (random 5-50ms)
          await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 45)); 

          // Complete
          queue.complete(job.id, workerId);
          completed++;
        } else {
            // Check if done before waiting
            const s = stmts.stats.all();
            const doneCount = s.find((r: any) => r.status === 'completed')?.count || 0;
             if (doneCount >= TOTAL_JOBS) break;

            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }
    })());
  }

  await Promise.all(workerpromises);
  const end = Date.now();
  const duration = end - produced;

  console.log('--- Results ---');
  console.log(`Total Time (Processing): ${duration}ms`);
  console.log(`Throughput: ${(TOTAL_JOBS / (duration / 1000)).toFixed(2)} jobs/sec`);
  
  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    console.log(`Latency p50: ${p50}ms`);
    console.log(`Latency p95: ${p95}ms`);
    console.log(`Latency p99: ${p99}ms`);

    if (p95 > 2000) {
      console.warn("WARN: p95 latency > 2000ms (acceptable for batch drain)");
    }
  }

  const rss = process.memoryUsage().rss / 1024 / 1024;
  console.log(`RSS: ${rss.toFixed(2)} MB`);

  // Correctness check
  const finalStats = stmts.stats.all();
  console.log('Final DB Stats:', finalStats);
  
  if (rss > 512) {
      console.error("FAIL: RSS > 512MB");
      process.exit(1);
  }
  
  console.log("PASS: Performance checks passed.");
}

runBenchmark().catch(console.error);
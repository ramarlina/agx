/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-queue-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SQLiteQueueAdapter stale job recovery", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    jest.resetModules();
    tempDir = createTempDir();
    dbPath = path.join(tempDir, "queue.db");
    process.env.AGX_QUEUE_STALE_MS = "50";
  });

  afterEach(() => {
    delete process.env.AGX_QUEUE_STALE_MS;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("requeues stale active jobs and processes them on the next poll", async () => {
    const { SQLiteQueueAdapter } = await import("@/lib/queue/sqlite-adapter");
    const adapter = new SQLiteQueueAdapter(dbPath);
    await adapter.start();

    try {
      const jobId = await adapter.send("test.queue", { hello: "world" }, { retryLimit: 2 });
      const db = (adapter as any).db;
      db.prepare(
        "UPDATE agx_jobs SET status = 'active', started_at = ?, worker_id = ? WHERE id = ?"
      ).run(Date.now() - 500, "dead-worker", jobId);

      let handledJobId: string | null = null;
      const handled = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for stale job recovery")), 1500);
        (adapter as any).processQueue("test.queue", {
          options: { batchSize: 1 },
          handler: async (jobs: Array<{ id: string }>) => {
            handledJobId = jobs[0]?.id ?? null;
            clearTimeout(timeout);
            resolve();
          },
        });
      });

      await handled;
      await sleep(20);

      const row = db
        .prepare("SELECT status, retry_count, worker_id, started_at, completed_at, error FROM agx_jobs WHERE id = ?")
        .get(jobId) as {
          status: string;
          retry_count: number;
          worker_id: string | null;
          started_at: number | null;
          completed_at: number | null;
          error: string | null;
        };

      expect(handledJobId).toBe(jobId);
      expect(row.status).toBe("completed");
      expect(row.retry_count).toBe(1);
      expect(row.worker_id).toBeNull();
      expect(row.started_at).toBeGreaterThan(0);
      expect(row.completed_at).toBeGreaterThan(0);
      expect(row.error).toContain("active timeout");
    } finally {
      await adapter.stop();
    }
  });

  test("fails stale active jobs that have exhausted retries", async () => {
    const { SQLiteQueueAdapter } = await import("@/lib/queue/sqlite-adapter");
    const adapter = new SQLiteQueueAdapter(dbPath);
    await adapter.start();

    try {
      const jobId = await adapter.send("test.queue", { hello: "world" }, { retryLimit: 1 });
      const db = (adapter as any).db;
      db.prepare(
        "UPDATE agx_jobs SET status = 'active', started_at = ?, worker_id = ?, retry_count = ? WHERE id = ?"
      ).run(Date.now() - 500, "dead-worker", 1, jobId);

      (adapter as any).processQueue("test.queue", {
        options: { batchSize: 1 },
        handler: async () => {
          throw new Error("stale exhausted job should not be dispatched");
        },
      });
      await sleep(20);

      const row = db
        .prepare("SELECT status, retry_count, failed_at, worker_id, started_at, error FROM agx_jobs WHERE id = ?")
        .get(jobId) as {
          status: string;
          retry_count: number;
          failed_at: number | null;
          worker_id: string | null;
          started_at: number | null;
          error: string | null;
        };

      expect(row.status).toBe("failed");
      expect(row.retry_count).toBe(1);
      expect(row.failed_at).toBeGreaterThan(0);
      expect(row.worker_id).toBeNull();
      expect(row.started_at).toBeNull();
      expect(row.error).toContain("active timeout");
    } finally {
      await adapter.stop();
    }
  });
});

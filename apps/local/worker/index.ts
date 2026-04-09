/**
 * Worker entry point - Replaces Temporal worker
 *
 * Run with: npm run worker (or tsx worker/index.ts)
 */

import "@/lib/check-node-version";
import { getQueue, QUEUE_NAMES, stopQueue } from "@/lib/queue/boss";
import { taskProcessor } from "@/lib/orchestrator/processor";
import { chatProcessor } from "@/lib/orchestrator/chat-processor";
import { ensureScheduleRuntime, stopScheduleRuntime } from "@/lib/orchestrator/schedule-runtime";
import { assertWorkerCount, MAX_WORKERS } from "@/lib/limits";

async function main(): Promise<void> {
    // Enforce operational limits (see docs/LIMITS.md)
    const requestedWorkers = Number(process.env.AGX_WORKER_COUNT) || 1;
    assertWorkerCount(requestedWorkers);

    console.log(`[worker] Starting SQLite worker (${requestedWorkers}/${MAX_WORKERS} max)...`);

    const queue = await getQueue();

    // Register job handlers - batchSize controls how many jobs are fetched at once
    await queue.work(
        QUEUE_NAMES.TASK_PROCESS,
        taskProcessor,
        { batchSize: 5 }
    );
    await queue.work(
        QUEUE_NAMES.CHAT_RUN_PROCESS,
        chatProcessor,
        { batchSize: 2 }
    );
    await ensureScheduleRuntime();

    console.log(`[worker] Listening on queue: ${QUEUE_NAMES.TASK_PROCESS}`);
    console.log(`[worker] Listening on queue: ${QUEUE_NAMES.CHAT_RUN_PROCESS}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`[worker] Received ${signal}, shutting down...`);
        await stopScheduleRuntime();
        await stopQueue();
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
    console.error("[worker] Fatal error:", error);
    process.exit(1);
});

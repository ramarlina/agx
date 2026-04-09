import { SQLiteQueueAdapter } from "./sqlite-adapter";
import { QueueAdapter } from "./adapter";

let queue: QueueAdapter | null = null;

export const QUEUE_NAMES = {
    TASK_PROCESS: "agx.task.process",
    CHAT_RUN_PROCESS: "agx.chat.process",
    TASK_CLEANUP: "agx.task.cleanup",
} as const;

export async function getQueue(): Promise<QueueAdapter> {
    if (queue) return queue;
    // Use SQLite adapter by default since we removed Postgres
    queue = new SQLiteQueueAdapter();
    await queue.start();
    return queue;
}

export async function stopQueue(): Promise<void> {
    if (queue) {
        await queue.stop();
        queue = null;
    }
}

// Re-export types if needed, or point consumers to adapter.ts
export type { QueueAdapter };

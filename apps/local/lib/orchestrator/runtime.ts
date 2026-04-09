import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { taskProcessor } from "@/lib/orchestrator/processor";
import { chatProcessor } from "@/lib/orchestrator/chat-processor";
import { ensureScheduleRuntime } from "@/lib/orchestrator/schedule-runtime";
import { writeDebugLog } from "@/lib/debug-log";

let bootstrapPromise: Promise<void> | null = null;

export async function ensureOrchestratorRuntime(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    writeDebugLog("orchestrator.bootstrap.start");
    const queue = await getQueue();
    await queue.work(QUEUE_NAMES.TASK_PROCESS, taskProcessor, { batchSize: 5 });
    await queue.work(QUEUE_NAMES.CHAT_RUN_PROCESS, chatProcessor, { batchSize: 2 });
    await ensureScheduleRuntime();
    writeDebugLog("orchestrator.bootstrap.ready", {
      queues: [QUEUE_NAMES.TASK_PROCESS, QUEUE_NAMES.CHAT_RUN_PROCESS],
    });
  })().catch((error) => {
    writeDebugLog("orchestrator.bootstrap.error", { error });
    bootstrapPromise = null;
    throw error;
  });

  return bootstrapPromise;
}

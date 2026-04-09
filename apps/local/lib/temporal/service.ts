/**
 * Temporal service compatibility layer.
 *
 * This repo migrated off Temporal to a SQLite-backed queue worker (`worker/index.ts`).
 * API routes still import `@/lib/temporal/service` so we provide a thin wrapper
 * that enqueues signals onto the task processing queue.
 */

import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import type { TicketType } from "@/lib/orchestration/stage-machine";

export type WorkflowStartParams = {
  taskId: string;
  userId: string;
  stage?: string;
  ticketType?: TicketType;
};

export async function startTaskWorkflow(params: WorkflowStartParams): Promise<void> {
  const queue = await getQueue();
  await queue.send(QUEUE_NAMES.TASK_PROCESS, {
    taskId: params.taskId,
    userId: params.userId,
    signal: "start",
    ticketType: params.ticketType || "task",
  });
}

export async function signalTaskWorkflow(
  taskId: string,
  signal: "agentResult" | "humanInput" | "daemonStep" | "cancel",
  payload: Record<string, unknown> & { userId?: string; ticketType?: TicketType } = {}
): Promise<void> {
  const queue = await getQueue();
  const userId = typeof payload.userId === "string" && payload.userId ? payload.userId : "";
  if (!userId) {
    throw new Error("signalTaskWorkflow requires payload.userId");
  }
  await queue.send(QUEUE_NAMES.TASK_PROCESS, {
    taskId,
    userId,
    signal,
    payload,
    ticketType: payload.ticketType || "task",
  });
}

export async function signalWithStartTaskWorkflow(
  params: WorkflowStartParams,
  signal: "agentResult" | "humanInput" | "daemonStep" | "cancel",
  payload: Record<string, unknown> = {}
): Promise<void> {
  const queue = await getQueue();

  // Best-effort: enqueue the signal. We do not attempt workflow idempotency here;
  // the worker reads the source of truth from Postgres.
  await queue.send(QUEUE_NAMES.TASK_PROCESS, {
    taskId: params.taskId,
    userId: params.userId,
    signal,
    payload,
    ticketType: params.ticketType || "task",
  });
}


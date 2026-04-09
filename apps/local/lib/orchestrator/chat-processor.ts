import type { Job } from "@/lib/queue/adapter";
import { createMultiplexedStream } from "@/lib/stream-multiplexer";
import { loadDbParticipants } from "@/lib/agent-participants";
import { killByThread, killByWorkspace } from "@/lib/agent-process-registry";
import type { ChatRunPayload, ChatRunJobData } from "@/lib/orchestrator/chat-types";
import {
  appendChatRunStepActivity,
  completeChatRunStepActivity,
  loadChatRunActivity,
  updateChatRunActivity,
} from "@/lib/orchestrator/chat-activities";
import { writeDebugLog } from "@/lib/debug-log";

function isChatRunPayload(value: unknown): value is ChatRunPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatRunPayload>;
  return Boolean(
    typeof candidate.threadId === "string" &&
      typeof candidate.prompt === "string" &&
      Array.isArray(candidate.participantIds)
  );
}

async function handleStart(job: Job<ChatRunJobData>): Promise<void> {
  writeDebugLog("chat-processor.start.received", {
    jobId: job.id,
    chatRunId: job.data.chatRunId,
    signal: job.data.signal,
  });
  const chatRun = await loadChatRunActivity(job.data.chatRunId);
  if (!chatRun) {
    writeDebugLog("chat-processor.start.missing", {
      chatRunId: job.data.chatRunId,
      jobId: job.id,
    });
    console.warn(`[chat-processor] Chat run ${job.data.chatRunId} not found, skipping`);
    return;
  }
  if (chatRun.status === "completed" || chatRun.status === "failed" || chatRun.status === "cancelled") {
    writeDebugLog("chat-processor.start.skip_terminal", {
      chatRunId: chatRun.id,
      status: chatRun.status,
    });
    return;
  }
  if (!isChatRunPayload(chatRun.payload)) {
    writeDebugLog("chat-processor.start.invalid_payload", {
      chatRunId: chatRun.id,
    });
    await updateChatRunActivity({
      id: chatRun.id,
      status: "failed",
      lastError: "Chat run payload is missing or invalid",
      completedAt: Date.now(),
    });
    return;
  }

  const step = await appendChatRunStepActivity({
    chatRunId: chatRun.id,
    kind: "model_turn",
    status: "running",
    inputPayload: {
      participantIds: chatRun.payload.participantIds,
      rootMessageId: chatRun.payload.rootMessageId,
      maxRounds: chatRun.payload.maxRounds,
    },
  });

  await updateChatRunActivity({
    id: chatRun.id,
    status: "running",
    currentStep: step.stepIndex,
    stepsUsed: step.stepIndex,
    lastError: null,
  });

  try {
    writeDebugLog("chat-processor.start.running", {
      chatRunId: chatRun.id,
      threadId: chatRun.threadId,
      rootMessageId: chatRun.rootMessageId,
      participantIds: chatRun.payload.participantIds,
    });
    const library = await loadDbParticipants();
    const participantIdSet = new Set(chatRun.payload.participantIds);
    const participants = chatRun.payload.participantIds
      .map((participantId) => library.find((participant) => participant.id === participantId))
      .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant));

    if (participants.length === 0) {
      writeDebugLog("chat-processor.start.no_participants_resolved", {
        chatRunId: chatRun.id,
        participantIds: chatRun.payload.participantIds,
      });
      throw new Error("No participants resolved for chat run");
    }

    const mentioned = new Set(
      chatRun.payload.mentionedIds.filter((participantId) => participantIdSet.has(participantId))
    );
    const initialParallelIds = new Set(
      chatRun.payload.initialParallelIds.filter((participantId) => participantIdSet.has(participantId))
    );

    const stream = createMultiplexedStream({
      threadId: chatRun.payload.threadId,
      allParticipants: participants,
      mentioned,
      initialParallelIds,
      prompt: chatRun.payload.prompt,
      projectContext: chatRun.payload.projectContext,
      maxRounds: chatRun.payload.maxRounds,
      recentHistory: chatRun.payload.recentHistory,
      currentUserMessageId: chatRun.payload.currentUserMessageId,
      rootMessageId: chatRun.payload.rootMessageId,
    });

    const reader = stream.getReader();
    writeDebugLog("chat-processor.stream.open", {
      chatRunId: chatRun.id,
      participantCount: participants.length,
    });
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    writeDebugLog("chat-processor.stream.complete", {
      chatRunId: chatRun.id,
    });

    await completeChatRunStepActivity({
      stepId: step.id,
      status: "completed",
      outputPayload: {
        completed: true,
        participantCount: participants.length,
      },
    });
    await updateChatRunActivity({
      id: chatRun.id,
      status: "completed",
      completedAt: Date.now(),
      result: {
        participantIds: participants.map((participant) => participant.id),
        rootMessageId: chatRun.payload.rootMessageId,
      },
    });
    writeDebugLog("chat-processor.complete", {
      chatRunId: chatRun.id,
      rootMessageId: chatRun.payload.rootMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeDebugLog("chat-processor.error", {
      chatRunId: chatRun.id,
      error,
      message,
    });
    await completeChatRunStepActivity({
      stepId: step.id,
      status: "failed",
      outputPayload: { error: message },
    });
    await updateChatRunActivity({
      id: chatRun.id,
      status: "failed",
      lastError: message,
      completedAt: Date.now(),
      result: { error: message },
    });
  }
}

async function handleCancel(job: Job<ChatRunJobData>): Promise<void> {
  writeDebugLog("chat-processor.cancel.received", {
    jobId: job.id,
    chatRunId: job.data.chatRunId,
  });
  const chatRun = await loadChatRunActivity(job.data.chatRunId);
  if (!chatRun) return;

  if (chatRun.rootMessageId) {
    killByThread(chatRun.rootMessageId);
  } else {
    killByWorkspace(chatRun.threadId);
  }

  await updateChatRunActivity({
    id: chatRun.id,
    status: "cancelled",
    lastError: job.data.payload?.reason || "Cancelled",
    completedAt: Date.now(),
    result: { cancelled: true },
  });
  writeDebugLog("chat-processor.cancel.complete", {
    chatRunId: chatRun.id,
    threadId: chatRun.threadId,
  });
}

async function processSingleJob(job: Job<ChatRunJobData>): Promise<void> {
  switch (job.data.signal) {
    case "start":
      await handleStart(job);
      break;
    case "cancel":
      await handleCancel(job);
      break;
    default:
      console.warn(`[chat-processor] Unknown signal: ${job.data.signal}`);
  }
}

export async function chatProcessor(jobs: Job<ChatRunJobData>[]): Promise<void> {
  for (const job of jobs) {
    await processSingleJob(job);
  }
}

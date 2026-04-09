import {
  appendChatRunStep,
  getChatRun,
  listChatRunSteps,
  updateChatRun,
  updateChatRunStep,
  type ChatRunRecord,
  type ChatRunStepRecord,
  type ChatRunStatus,
} from "@/lib/history-store";

export async function loadChatRunActivity(chatRunId: string): Promise<ChatRunRecord | null> {
  return getChatRun(chatRunId);
}

export async function updateChatRunActivity(input: {
  id: string;
  status?: ChatRunStatus;
  currentStep?: number;
  stepsUsed?: number;
  lastError?: string | null;
  result?: Record<string, unknown> | null;
  completedAt?: number | null;
}): Promise<ChatRunRecord | null> {
  return updateChatRun(input);
}

export async function appendChatRunStepActivity(input: {
  chatRunId: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  participantId?: string | null;
  inputPayload?: Record<string, unknown> | null;
  outputPayload?: Record<string, unknown> | null;
}): Promise<ChatRunStepRecord> {
  const existingSteps = await listChatRunSteps(input.chatRunId);
  return appendChatRunStep({
    id: crypto.randomUUID(),
    chatRunId: input.chatRunId,
    stepIndex: existingSteps.length + 1,
    kind: input.kind,
    status: input.status,
    participantId: input.participantId,
    inputPayload: input.inputPayload,
    outputPayload: input.outputPayload,
  });
}

export async function completeChatRunStepActivity(input: {
  stepId: string;
  status: "completed" | "failed";
  outputPayload?: Record<string, unknown> | null;
}): Promise<ChatRunStepRecord | null> {
  return updateChatRunStep({
    id: input.stepId,
    status: input.status,
    outputPayload: input.outputPayload,
    completedAt: Date.now(),
  });
}

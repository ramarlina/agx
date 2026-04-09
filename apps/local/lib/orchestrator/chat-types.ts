import type { Participant } from "@/lib/types";
import type { StreamProjectContext } from "@/lib/stream-multiplexer";

export type ChatRunSignal = "start" | "cancel";

export interface ChatRunPayload {
  threadId: string;
  prompt: string;
  projectContext?: StreamProjectContext;
  mentionedIds: string[];
  initialParallelIds: string[];
  maxRounds: number;
  recentHistory: Array<{ id: string; name: string; content: string }>;
  currentUserMessageId: string | null;
  rootMessageId: string | null;
  participantIds: string[];
}

export interface ChatRunJobData {
  chatRunId: string;
  userId: string;
  signal: ChatRunSignal;
  payload?: { reason?: string };
}

export interface ResolvedChatRunContext {
  payload: ChatRunPayload;
  participants: Participant[];
}

import type { ThreadStatus } from "./storage/thread-adapter";

export type ChatProvider = "claude" | "gemini" | "ollama" | "codex" | "zai";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  archived: boolean;
}

export interface Participant {
  id: string;
  name: string;
  title?: string;
  provider: ChatProvider;
  model: string | null;
  color: string;
  identity?: string;
  voice?: string;
  seed?: string;
  identityFile?: string;
  skills?: Skill[];
  skillBindings?: SkillBinding[];
  variables?: Record<string, string>;
}

export interface Skill {
  file: string;
  condition: string;
}

export interface SkillBinding {
  repo: string;
  skillId: string;
  condition?: string;
}

export type ReactionType = "ack" | "working" | "done" | "clarify" | "blocked";

export interface MessageReaction {
  type: ReactionType;
  count: number;
  participantIds: string[];
}

export type AttachmentStatus = "staged" | "uploading" | "uploaded" | "failed";

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  url?: string;
  error?: string;
  progress?: number;
}

export interface GroupMessage {
  id: string;
  role: "user" | "assistant";
  participantId: string | null; // null for user messages
  content: string;
  timestamp: number;
  conversationId?: string;
  reactions?: MessageReaction[];
  attachments?: Attachment[];
  // Thread reply fields
  rootMessageId?: string | null; // null = main chat, set = belongs to thread
  parentMessageId?: string | null; // direct parent for reply chains
  depth?: number; // 0 = main, 1+ = thread reply level
  threadStatus?: ThreadStatus;
  outcomeNote?: string;
  sendFailed?: boolean;
}

export interface ThreadInfo {
  rootMessageId: string;
  replyCount: number;
  participants: string[]; // participant IDs
  lastReply?: GroupMessage;
  lastActivityAt: number;
}

export interface MessageSearchResult {
  threadId: string;
  messageId: string;
  role: "user" | "assistant";
  participantId: string | null;
  snippet: string;
  timestamp: number;
  rootMessageId: string | null;
}

export interface MessageSearchResponse {
  results: MessageSearchResult[];
  total: number;
  query: string;
}

export type ChatEvent =
  | { type: "participant-thinking"; participantId: string }
  | { type: "participant-start"; participantId: string }
  | { type: "text-delta"; participantId: string; delta: string }
  | { type: "participant-error"; participantId: string; error: string }
  | { type: "message-reactions"; messageId: string; reactions: MessageReaction[] }
  | { type: "participant-end"; participantId: string; messageId?: string; content?: string }
  | { type: "log"; participantId: string; stream: "stdout" | "stderr"; line: string }
  | { type: "done" };

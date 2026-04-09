import { LocalThreadAdapter } from "@/lib/storage";
import type { SaveThreadInput, Thread, ThreadStatus } from "@/lib/storage";
import type { GroupMessage } from "@/lib/types";

const adapter = new LocalThreadAdapter();

const createThreadId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const sortByUpdatedAt = (threads: Thread[]) =>
  [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

function isArchivedThread(thread: Thread): boolean {
  const archived = (thread.metadata as { archived?: unknown } | undefined)?.archived;
  return archived === true;
}

function deriveTitleFromMessages(messages: GroupMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content?.trim();
  if (!firstUserMessage) return undefined;
  const compact = firstUserMessage.replace(/\s+/g, " ");
  return compact.length > 60 ? `${compact.slice(0, 60).trim()}…` : compact;
}

function areMessagesEqual(a: GroupMessage[], b: GroupMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.role !== right.role ||
      left.participantId !== right.participantId ||
      left.content !== right.content ||
      left.timestamp !== right.timestamp
    ) {
      return false;
    }
  }
  return true;
}

export const threadService = {
  async listThreads(): Promise<Thread[]> {
    const result = await adapter.listThreads({ order: "desc" });
    return sortByUpdatedAt(result.threads.filter((thread) => !isArchivedThread(thread)));
  },

  async createThread(
    input?: Partial<Pick<SaveThreadInput, "id" | "title" | "messages" | "metadata">>
  ): Promise<Thread> {
    const requestedId = typeof input?.id === "string" ? input.id.trim() : "";

    if (requestedId) {
      const existing = await adapter.loadThread(requestedId);
      if (existing) {
        const metadata = {
          ...(existing.metadata ?? {}),
          ...(input?.metadata ?? {}),
          archived: false,
          archivedAt: null,
        };
        return adapter.saveThread({
          id: existing.id,
          title: input?.title ?? existing.title,
          messages: input?.messages?.length ? input.messages : existing.messages,
          metadata,
          createdAt: existing.createdAt,
        });
      }
    }

    const payload: SaveThreadInput = {
      id: requestedId || createThreadId(),
      messages: input?.messages?.length ? input.messages : [],
      title: input?.title,
      metadata: input?.metadata,
    };
    return adapter.saveThread(payload);
  },

  async deleteThread(threadId: string) {
    const id = threadId.trim();
    if (!id) return;

    const existing = await adapter.loadThread(id);
    if (!existing) return;

    const metadata = {
      ...(existing.metadata ?? {}),
      archived: true,
      archivedAt: Date.now(),
    };

    await adapter.saveThread({
      id: existing.id,
      title: existing.title,
      messages: existing.messages,
      metadata,
      createdAt: existing.createdAt,
    });
  },

  async renameThread(threadId: string, title: string) {
    const id = threadId.trim();
    const nextTitle = title.trim();
    if (!id || !nextTitle) return null;

    const existing = await adapter.loadThread(id);
    if (!existing) return null;

    if ((existing.title?.trim() ?? "") === nextTitle) {
      return existing;
    }

    return adapter.saveThread({
      id: existing.id,
      title: nextTitle,
      messages: existing.messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
    });
  },

  async updateThreadStatus(threadId: string, status: ThreadStatus): Promise<Thread | null> {
    const existing = await adapter.loadThread(threadId);
    if (!existing) return null;
    if (existing.status === status) return existing;
    return adapter.saveThread({
      id: existing.id,
      title: existing.title,
      messages: existing.messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
      status,
      outcomeNote: existing.outcomeNote,
    });
  },

  async updateThreadOutcomeNote(threadId: string, outcomeNote: string): Promise<Thread | null> {
    const existing = await adapter.loadThread(threadId);
    if (!existing) return null;
    if (existing.outcomeNote === outcomeNote) return existing;
    return adapter.saveThread({
      id: existing.id,
      title: existing.title,
      messages: existing.messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
      status: existing.status,
      outcomeNote,
    });
  },

  async updateMessageThreadStatus(threadId: string, messageId: string, status: ThreadStatus): Promise<Thread | null> {
    const existing = await adapter.loadThread(threadId);
    if (!existing) return null;
    const messages = existing.messages.map((msg) =>
      msg.id === messageId ? { ...msg, threadStatus: status } : msg
    );
    return adapter.saveThread({
      id: existing.id,
      title: existing.title,
      messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
      status: existing.status,
      outcomeNote: existing.outcomeNote,
    });
  },

  async updateMessageOutcomeNote(threadId: string, messageId: string, note: string): Promise<Thread | null> {
    const existing = await adapter.loadThread(threadId);
    if (!existing) return null;
    const messages = existing.messages.map((msg) =>
      msg.id === messageId ? { ...msg, outcomeNote: note } : msg
    );
    return adapter.saveThread({
      id: existing.id,
      title: existing.title,
      messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
      status: existing.status,
      outcomeNote: existing.outcomeNote,
    });
  },

  async saveThreadMessages(threadId: string, messages: GroupMessage[]): Promise<Thread | null> {
    const existing = await adapter.loadThread(threadId);
    if (!existing) return null;

    const title = existing.title?.trim() || deriveTitleFromMessages(messages);
    if (areMessagesEqual(existing.messages, messages) && (existing.title?.trim() || undefined) === title) {
      return existing;
    }

    return adapter.saveThread({
      id: existing.id,
      title,
      messages,
      metadata: existing.metadata,
      createdAt: existing.createdAt,
    });
  },
};

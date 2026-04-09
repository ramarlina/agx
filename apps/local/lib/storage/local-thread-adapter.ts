import type { ListThreadsResult, SaveThreadInput, Thread, ThreadAdapter, ThreadListOptions } from "./thread-adapter";

const STORAGE_KEY = "agx-chat:threads";

interface LocalThreadState {
  threads: Record<string, Thread>;
}

function getStorage(): Storage {
  const globalStorage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  if (!globalStorage) {
    throw new Error(
      "LocalThreadAdapter requires a browser-like environment with `localStorage`."
    );
  }
  return globalStorage;
}

function readState(): LocalThreadState {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return { threads: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.threads && typeof parsed.threads === "object") {
      return {
        threads: Object.fromEntries(
          Object.entries(parsed.threads).map(([id, value]) => [
            id,
            sanitizeStoredThread(id, value),
          ])
        ),
      };
    }
  } catch {
    // Fall through to empty state when parsing fails.
  }
  return { threads: {} };
}

function writeState(state: LocalThreadState): void {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
}

function sanitizeStoredThread(id: string, value: unknown): Thread {
  const base = value as Partial<Thread> | undefined;
  return {
    id,
    title: base?.title,
    messages: Array.isArray(base?.messages) ? [...(base!.messages as Thread["messages"])] : [],
    createdAt: typeof base?.createdAt === "number" ? base.createdAt : Date.now(),
    updatedAt: typeof base?.updatedAt === "number" ? base.updatedAt : Date.now(),
    metadata: base?.metadata,
    status: base?.status,
    outcomeNote: base?.outcomeNote,
    projectId:
      typeof base?.projectId === "string"
        ? base.projectId
        : (typeof base?.teamId === "string" ? base.teamId : (base?.projectId === null || base?.teamId === null ? null : undefined)),
  };
}

function cloneThread(thread: Thread): Thread {
  return {
    ...thread,
    messages: thread.messages.map((msg) => ({ ...msg })),
    metadata: thread.metadata ? { ...thread.metadata } : undefined,
  };
}

export class LocalThreadAdapter implements ThreadAdapter {
  async saveThread(input: SaveThreadInput): Promise<Thread> {
    const now = Date.now();
    const state = readState();
    const existing = state.threads[input.id];
    const createdAt = existing?.createdAt ?? input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    const thread: Thread = {
      id: input.id,
      title: input.title,
      messages: input.messages.map((msg) => ({ ...msg })),
      metadata: input.metadata,
      createdAt,
      updatedAt,
      status: input.status,
      outcomeNote: input.outcomeNote,
      projectId: input.projectId ?? input.teamId,
    };
    state.threads[input.id] = thread;
    writeState(state);
    return cloneThread(thread);
  }

  async loadThread(threadId: string): Promise<Thread | null> {
    const state = readState();
    const thread = state.threads[threadId];
    return thread ? cloneThread(thread) : null;
  }

  async listThreads(options?: ThreadListOptions): Promise<ListThreadsResult> {
    const state = readState();
    const all = Object.values(state.threads);
    const order = options?.order ?? "desc";
    const sorted = [...all].sort((a, b) =>
      order === "asc" ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt
    );
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const page = typeof limit === "number" && limit >= 0
      ? sorted.slice(offset, offset + limit)
      : sorted.slice(offset);
    return {
      total: all.length,
      threads: page.map(cloneThread),
    };
  }

  async deleteThread(threadId: string): Promise<void> {
    const state = readState();
    if (state.threads[threadId]) {
      delete state.threads[threadId];
      writeState(state);
    }
  }
}

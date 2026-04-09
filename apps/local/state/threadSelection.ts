import type { Thread } from "@/lib/storage";

const THREAD_SELECTION_STORAGE_KEY = "agx-chat:last-thread";

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadLastThreadId(): string | null {
  if (!isStorageAvailable()) {
    return null;
  }

  try {
    return window.localStorage.getItem(THREAD_SELECTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistLastThreadId(threadId: string): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(THREAD_SELECTION_STORAGE_KEY, threadId);
  } catch {
    // ignore storage failures (e.g., quota exceeded)
  }
}

export function clearLastThreadId(): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(THREAD_SELECTION_STORAGE_KEY);
  } catch {
    // ignore storage failures (e.g., quota exceeded)
  }
}

export type InitialThreadSelection = {
  threadId: string | null;
  shouldClearSavedId: boolean;
  restoredFromStorage: boolean;
};

export function resolveInitialThreadSelection(
  threads: Thread[],
  savedThreadId: string | null
): InitialThreadSelection {
  const fallbackThreadId = threads[0]?.id ?? null;

  if (!savedThreadId) {
    return { threadId: fallbackThreadId, shouldClearSavedId: false, restoredFromStorage: false };
  }

  const savedThreadExists = threads.some((thread) => thread.id === savedThreadId);
  if (savedThreadExists) {
    return { threadId: savedThreadId, shouldClearSavedId: false, restoredFromStorage: true };
  }

  return { threadId: fallbackThreadId, shouldClearSavedId: true, restoredFromStorage: false };
}

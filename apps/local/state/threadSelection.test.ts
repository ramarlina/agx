import type { Thread } from "@/lib/storage";
import {
  clearLastThreadId,
  loadLastThreadId,
  persistLastThreadId,
  resolveInitialThreadSelection,
} from "./threadSelection";

type ThreadStorage = Record<string, string>;

function withFakeLocalStorage<T>(callback: (storage: ThreadStorage) => T): T {
  const originalWindow = globalThis.window;
  const storage: ThreadStorage = {};
  const fakeLocalStorage = {
    getItem(key: string) {
      return storage[key] ?? null;
    },
    setItem(key: string, value: string) {
      storage[key] = value;
    },
    removeItem(key: string) {
      delete storage[key];
    },
  };
  globalThis.window = { localStorage: fakeLocalStorage } as unknown as Window;

  try {
    return callback(storage);
  } finally {
    globalThis.window = originalWindow;
  }
}

function createThread(id: string, updatedAt: number): Thread {
  return {
    id,
    title: "",
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("threadSelection", () => {
  test("persist/load/clear enjoy the last thread id lifecycle", () => {
    withFakeLocalStorage(() => {
      expect(loadLastThreadId()).toBeNull();
      persistLastThreadId("thread-abc");
      expect(loadLastThreadId()).toBe("thread-abc");
      persistLastThreadId("thread-def");
      expect(loadLastThreadId()).toBe("thread-def");
      clearLastThreadId();
      expect(loadLastThreadId()).toBeNull();
    });
  });

  test("resolveInitialThreadSelection restores saved thread when it exists", () => {
    const threads = [createThread("thread-1", 2), createThread("thread-2", 1)];
    const result = resolveInitialThreadSelection(threads, "thread-2");
    expect(result.threadId).toBe("thread-2");
    expect(result.shouldClearSavedId).toBe(false);
    expect(result.restoredFromStorage).toBe(true);
  });

  test("resolveInitialThreadSelection falls back and clears missing saved id", () => {
    const threads = [createThread("thread-1", 2), createThread("thread-2", 1)];
    const result = resolveInitialThreadSelection(threads, "missing");
    expect(result.threadId).toBe("thread-1");
    expect(result.shouldClearSavedId).toBe(true);
    expect(result.restoredFromStorage).toBe(false);
  });

  test("resolveInitialThreadSelection defaults to first thread when no saved id exists", () => {
    const threads = [createThread("thread-1", 2), createThread("thread-2", 1)];
    const result = resolveInitialThreadSelection(threads, null);
    expect(result.threadId).toBe("thread-1");
    expect(result.shouldClearSavedId).toBe(false);
    expect(result.restoredFromStorage).toBe(false);
  });
});

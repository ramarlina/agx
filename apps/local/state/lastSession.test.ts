import {
  loadLastRunForIssue,
  persistLastRunForIssue,
  loadLastSessionForEntity,
  persistLastSessionForEntity,
} from "./lastSession";

type Storage = Record<string, string>;

function withFakeLocalStorage<T>(callback: (storage: Storage) => T): T {
  const originalWindow = globalThis.window;
  const storage: Storage = {};
  const fakeLocalStorage = {
    getItem(key: string) { return storage[key] ?? null; },
    setItem(key: string, value: string) { storage[key] = value; },
    removeItem(key: string) { delete storage[key]; },
  };
  globalThis.window = { localStorage: fakeLocalStorage } as unknown as Window;
  try {
    return callback(storage);
  } finally {
    globalThis.window = originalWindow;
  }
}

describe("lastSession", () => {
  describe("run storage", () => {
    test("returns null when no run stored for issue", () => {
      withFakeLocalStorage(() => {
        expect(loadLastRunForIssue("issue-1")).toBeNull();
      });
    });

    test("persists and loads run for issue", () => {
      withFakeLocalStorage(() => {
        persistLastRunForIssue("issue-1", "run-abc");
        expect(loadLastRunForIssue("issue-1")).toBe("run-abc");
      });
    });

    test("overwriting persists the latest run", () => {
      withFakeLocalStorage(() => {
        persistLastRunForIssue("issue-1", "run-abc");
        persistLastRunForIssue("issue-1", "run-xyz");
        expect(loadLastRunForIssue("issue-1")).toBe("run-xyz");
      });
    });

    test("stores runs for multiple issues independently", () => {
      withFakeLocalStorage(() => {
        persistLastRunForIssue("issue-1", "run-a");
        persistLastRunForIssue("issue-2", "run-b");
        expect(loadLastRunForIssue("issue-1")).toBe("run-a");
        expect(loadLastRunForIssue("issue-2")).toBe("run-b");
      });
    });
  });

  describe("session storage", () => {
    test("returns null when no session stored for entity", () => {
      withFakeLocalStorage(() => {
        expect(loadLastSessionForEntity("obj-1")).toBeNull();
      });
    });

    test("persists and loads session for entity", () => {
      withFakeLocalStorage(() => {
        persistLastSessionForEntity("obj-1", "session-abc");
        expect(loadLastSessionForEntity("obj-1")).toBe("session-abc");
      });
    });

    test("run and session maps are stored independently", () => {
      withFakeLocalStorage(() => {
        persistLastRunForIssue("issue-1", "run-a");
        persistLastSessionForEntity("obj-1", "session-b");
        expect(loadLastRunForIssue("issue-1")).toBe("run-a");
        expect(loadLastSessionForEntity("obj-1")).toBe("session-b");
      });
    });
  });

});

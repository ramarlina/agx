import {
  getLinearRunScriptsStorageKey,
  loadLinearRunScripts,
  persistLinearRunScripts,
} from "./linearRunScripts";

type LocalStorageMap = Record<string, string>;

function withFakeLocalStorage<T>(callback: (storage: LocalStorageMap) => T): T {
  const originalWindow = globalThis.window;
  const storage: LocalStorageMap = {};
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

describe("linearRunScripts", () => {
  test("persists and restores scripts per project slug", () => {
    withFakeLocalStorage((storage) => {
      const key = getLinearRunScriptsStorageKey("agx-cloud");
      expect(loadLinearRunScripts("agx-cloud")).toEqual({
        activeScriptId: null,
        scripts: [],
      });

      persistLinearRunScripts("agx-cloud", {
        activeScriptId: "script-1",
        scripts: [
          {
            id: "script-1",
            name: "Investigation",
            prompt: "Read {{ticket.identifier}} first.",
            createdAt: "2026-04-08T01:00:00.000Z",
            updatedAt: "2026-04-08T02:00:00.000Z",
          },
        ],
      });

      expect(storage[key]).toContain("Investigation");
      expect(loadLinearRunScripts("agx-cloud")).toEqual({
        activeScriptId: "script-1",
        scripts: [
          {
            id: "script-1",
            name: "Investigation",
            prompt: "Read {{ticket.identifier}} first.",
            createdAt: "2026-04-08T01:00:00.000Z",
            updatedAt: "2026-04-08T02:00:00.000Z",
          },
        ],
      });
    });
  });

  test("clears invalid active script ids while preserving valid scripts", () => {
    withFakeLocalStorage((storage) => {
      storage[getLinearRunScriptsStorageKey("agx-cloud")] = JSON.stringify({
        activeScriptId: "missing-script",
        scripts: [
          {
            id: "script-1",
            name: "Implementation",
            prompt: "Implement carefully.",
            createdAt: "2026-04-08T01:00:00.000Z",
            updatedAt: "2026-04-08T02:00:00.000Z",
          },
        ],
      });

      expect(loadLinearRunScripts("agx-cloud")).toEqual({
        activeScriptId: null,
        scripts: [
          {
            id: "script-1",
            name: "Implementation",
            prompt: "Implement carefully.",
            createdAt: "2026-04-08T01:00:00.000Z",
            updatedAt: "2026-04-08T02:00:00.000Z",
          },
        ],
      });
    });
  });
});

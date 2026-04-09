export const UI_SETTINGS_STORAGE_KEY = "agx-chat:uiSettings";
const DEFAULT_THREAD_SIDEBAR_VISIBLE = false;

export interface UiSettings {
  threadSidebarVisible: boolean;
}

const DEFAULT_UI_SETTINGS: UiSettings = {
  threadSidebarVisible: DEFAULT_THREAD_SIDEBAR_VISIBLE,
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readUiSettings(): UiSettings {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_UI_SETTINGS };
  }

  const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_UI_SETTINGS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...DEFAULT_UI_SETTINGS,
      threadSidebarVisible:
        typeof parsed.threadSidebarVisible === "boolean"
          ? parsed.threadSidebarVisible
          : DEFAULT_THREAD_SIDEBAR_VISIBLE,
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function writeUiSettings(settings: UiSettings): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors (e.g., quota exceeded)
  }
}

export function loadWorkspaceSidebarVisible(): boolean {
  return readUiSettings().threadSidebarVisible;
}

export function persistWorkspaceSidebarVisible(visible: boolean): void {
  const nextSettings: UiSettings = {
    ...readUiSettings(),
    threadSidebarVisible: visible,
  };
  writeUiSettings(nextSettings);
}

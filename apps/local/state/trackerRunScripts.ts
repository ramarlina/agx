const TRACKER_RUN_SCRIPTS_STORAGE_PREFIX = "agx-tracker:runScripts";

export interface TrackerRunScript {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerRunScriptsState {
  activeScriptId: string | null;
  scripts: TrackerRunScript[];
}

const DEFAULT_TRACKER_RUN_SCRIPTS_STATE: TrackerRunScriptsState = {
  activeScriptId: null,
  scripts: [],
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeProjectSlug(projectSlug?: string | null): string {
  return String(projectSlug ?? "").trim().toLowerCase();
}

function normalizeScript(input: unknown): TrackerRunScript | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<TrackerRunScript>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  const createdAt =
    typeof candidate.createdAt === "string" && candidate.createdAt.trim()
      ? candidate.createdAt.trim()
      : "";
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
      ? candidate.updatedAt.trim()
      : createdAt;

  if (!id || !name || !prompt || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    name,
    prompt,
    createdAt,
    updatedAt,
  };
}

function sortScripts(scripts: TrackerRunScript[]): TrackerRunScript[] {
  return [...scripts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeState(value: unknown): TrackerRunScriptsState {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_TRACKER_RUN_SCRIPTS_STATE };
  }

  const candidate = value as Partial<TrackerRunScriptsState>;
  const scripts = Array.isArray(candidate.scripts)
    ? sortScripts(
        candidate.scripts
          .map((script) => normalizeScript(script))
          .filter((script): script is TrackerRunScript => Boolean(script))
      )
    : [];
  const activeScriptId =
    typeof candidate.activeScriptId === "string" && candidate.activeScriptId.trim()
      ? candidate.activeScriptId.trim()
      : null;

  return {
    activeScriptId:
      activeScriptId && scripts.some((script) => script.id === activeScriptId)
        ? activeScriptId
        : null,
    scripts,
  };
}

export function getTrackerRunScriptsStorageKey(
  trackerType: string,
  projectSlug?: string | null
): string {
  const normalizedProjectSlug = normalizeProjectSlug(projectSlug);
  const prefix = `${TRACKER_RUN_SCRIPTS_STORAGE_PREFIX}:${trackerType}`;
  return normalizedProjectSlug
    ? `${prefix}:${normalizedProjectSlug}`
    : `${prefix}:global`;
}

export function loadTrackerRunScripts(
  trackerType: string,
  projectSlug?: string | null
): TrackerRunScriptsState {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_TRACKER_RUN_SCRIPTS_STATE };
  }

  const raw = window.localStorage.getItem(getTrackerRunScriptsStorageKey(trackerType, projectSlug));
  if (!raw) {
    return { ...DEFAULT_TRACKER_RUN_SCRIPTS_STATE };
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TRACKER_RUN_SCRIPTS_STATE };
  }
}

export function persistTrackerRunScripts(
  trackerType: string,
  projectSlug: string | null | undefined,
  state: TrackerRunScriptsState
): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    const normalized = normalizeState(state);
    window.localStorage.setItem(
      getTrackerRunScriptsStorageKey(trackerType, projectSlug),
      JSON.stringify(normalized)
    );
  } catch {
    // ignore storage errors
  }
}
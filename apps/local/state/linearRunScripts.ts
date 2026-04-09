const LINEAR_RUN_SCRIPTS_STORAGE_PREFIX = "agx-linear:runScripts";

export interface LinearRunScript {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinearRunScriptsState {
  activeScriptId: string | null;
  scripts: LinearRunScript[];
}

const DEFAULT_LINEAR_RUN_SCRIPTS_STATE: LinearRunScriptsState = {
  activeScriptId: null,
  scripts: [],
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeProjectSlug(projectSlug?: string | null): string {
  return String(projectSlug ?? "").trim().toLowerCase();
}

function normalizeScript(input: unknown): LinearRunScript | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<LinearRunScript>;
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

function sortScripts(scripts: LinearRunScript[]): LinearRunScript[] {
  return [...scripts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeState(value: unknown): LinearRunScriptsState {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_LINEAR_RUN_SCRIPTS_STATE };
  }

  const candidate = value as Partial<LinearRunScriptsState>;
  const scripts = Array.isArray(candidate.scripts)
    ? sortScripts(
        candidate.scripts
          .map((script) => normalizeScript(script))
          .filter((script): script is LinearRunScript => Boolean(script))
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

export function getLinearRunScriptsStorageKey(projectSlug?: string | null): string {
  const normalizedProjectSlug = normalizeProjectSlug(projectSlug);
  return normalizedProjectSlug
    ? `${LINEAR_RUN_SCRIPTS_STORAGE_PREFIX}:${normalizedProjectSlug}`
    : `${LINEAR_RUN_SCRIPTS_STORAGE_PREFIX}:global`;
}

export function loadLinearRunScripts(projectSlug?: string | null): LinearRunScriptsState {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_LINEAR_RUN_SCRIPTS_STATE };
  }

  const raw = window.localStorage.getItem(getLinearRunScriptsStorageKey(projectSlug));
  if (!raw) {
    return { ...DEFAULT_LINEAR_RUN_SCRIPTS_STATE };
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LINEAR_RUN_SCRIPTS_STATE };
  }
}

export function persistLinearRunScripts(
  projectSlug: string | null | undefined,
  state: LinearRunScriptsState
): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    const normalized = normalizeState(state);
    window.localStorage.setItem(
      getLinearRunScriptsStorageKey(projectSlug),
      JSON.stringify(normalized)
    );
  } catch {
    // ignore storage errors
  }
}

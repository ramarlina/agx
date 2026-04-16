const LAST_RUN_KEY = "agx:lastRun";
const LAST_SESSION_KEY = "agx:lastSession";

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadMap(key: string): Record<string, string> {
  if (!isStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveMap(key: string, map: Record<string, string>): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function loadLastRunForIssue(issueId: string): string | null {
  return loadMap(LAST_RUN_KEY)[issueId] ?? null;
}

export function persistLastRunForIssue(issueId: string, runId: string): void {
  const map = loadMap(LAST_RUN_KEY);
  map[issueId] = runId;
  saveMap(LAST_RUN_KEY, map);
}

export function loadLastSessionForEntity(entityId: string): string | null {
  return loadMap(LAST_SESSION_KEY)[entityId] ?? null;
}

export function persistLastSessionForEntity(entityId: string, sessionId: string): void {
  const map = loadMap(LAST_SESSION_KEY);
  map[entityId] = sessionId;
  saveMap(LAST_SESSION_KEY, map);
}

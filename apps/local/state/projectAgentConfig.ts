const PROJECT_AGENT_CONFIG_STORAGE_KEY = "agx-chat:project-agent-config";

interface StoredProjectAgentConfig {
  activeParticipantIdsByThread: Record<string, string[]>;
}

const DEFAULT_CONFIG: StoredProjectAgentConfig = {
  activeParticipantIdsByThread: {},
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    sanitized.push(trimmed);
  }
  return sanitized;
}

function readConfig(): StoredProjectAgentConfig {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = window.localStorage.getItem(PROJECT_AGENT_CONFIG_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProjectAgentConfig>;
    const map = parsed.activeParticipantIdsByThread;
    if (!map || typeof map !== "object") {
      return { ...DEFAULT_CONFIG };
    }

    return {
      activeParticipantIdsByThread: Object.fromEntries(
        Object.entries(map).map(([threadId, ids]) => [threadId, sanitizeIds(ids)])
      ),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: StoredProjectAgentConfig): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(PROJECT_AGENT_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage failures (e.g. quota exceeded)
  }
}

export function loadStoredActiveParticipantIds(threadId: string): string[] | null {
  const id = threadId.trim();
  if (!id) return null;

  const config = readConfig();
  if (!(id in config.activeParticipantIdsByThread)) {
    return null;
  }

  return [...config.activeParticipantIdsByThread[id]];
}

export function persistStoredActiveParticipantIds(threadId: string, ids: string[]): void {
  const id = threadId.trim();
  if (!id) return;

  const config = readConfig();
  config.activeParticipantIdsByThread[id] = sanitizeIds(ids);
  writeConfig(config);
}

export function clearStoredActiveParticipantIds(threadId: string): void {
  const id = threadId.trim();
  if (!id) return;

  const config = readConfig();
  if (!(id in config.activeParticipantIdsByThread)) {
    return;
  }
  delete config.activeParticipantIdsByThread[id];
  writeConfig(config);
}

export function loadEffectiveActiveParticipantIds(
  threadId: string | null,
  participantIds: string[]
): string[] {
  const all = sanitizeIds(participantIds);
  if (!threadId) {
    return all;
  }

  const stored = loadStoredActiveParticipantIds(threadId);
  if (stored === null) {
    return all;
  }

  const available = new Set(all);
  return stored.filter((id) => available.has(id));
}


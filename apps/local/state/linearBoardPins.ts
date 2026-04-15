const LINEAR_BOARD_PINS_STORAGE_PREFIX = "agx-linear:pinnedIssues";

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStorageKey(projectSlug?: string | null): string {
  const normalized = String(projectSlug ?? "").trim().toLowerCase();
  return normalized
    ? `${LINEAR_BOARD_PINS_STORAGE_PREFIX}:${normalized}`
    : `${LINEAR_BOARD_PINS_STORAGE_PREFIX}:global`;
}

export function loadPinnedIssueIds(projectSlug?: string | null): Set<string> {
  if (!isStorageAvailable()) return new Set();

  const raw = window.localStorage.getItem(getStorageKey(projectSlug));
  if (!raw) return new Set();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((id): id is string => typeof id === "string" && id.length > 0)
    );
  } catch {
    return new Set();
  }
}

export function persistPinnedIssueIds(
  projectSlug: string | null | undefined,
  ids: Set<string>
): void {
  if (!isStorageAvailable()) return;

  try {
    window.localStorage.setItem(
      getStorageKey(projectSlug),
      JSON.stringify([...ids])
    );
  } catch {
    // ignore storage errors
  }
}

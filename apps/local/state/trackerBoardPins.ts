const TRACKER_BOARD_PINS_STORAGE_PREFIX = "agx-tracker:pinnedItems";

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStorageKey(trackerType: string, projectSlug?: string | null): string {
  const normalized = String(projectSlug ?? "").trim().toLowerCase();
  const prefix = `${TRACKER_BOARD_PINS_STORAGE_PREFIX}:${trackerType}`;
  return normalized
    ? `${prefix}:${normalized}`
    : `${prefix}:global`;
}

export function loadPinnedTrackerItemIds(
  trackerType: string,
  projectSlug?: string | null
): Set<string> {
  if (!isStorageAvailable()) return new Set();

  const raw = window.localStorage.getItem(getStorageKey(trackerType, projectSlug));
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

export function persistPinnedTrackerItemIds(
  trackerType: string,
  projectSlug: string | null | undefined,
  ids: Set<string>
): void {
  if (!isStorageAvailable()) return;

  try {
    window.localStorage.setItem(
      getStorageKey(trackerType, projectSlug),
      JSON.stringify([...ids])
    );
  } catch {
    // ignore storage errors
  }
}
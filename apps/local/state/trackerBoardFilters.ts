const TRACKER_BOARD_FILTERS_STORAGE_PREFIX = "agx-tracker:boardFilters";

export interface TrackerBoardFilters {
  search: string;
  assigneeIds: string[];
  statusCategories: string[];
  groupIds: string[];
  sortBy: "activity" | "identifier" | "status" | "created";
  sortDir: "asc" | "desc";
  hasActivity: boolean;
}

const DEFAULT_TRACKER_BOARD_FILTERS: TrackerBoardFilters = {
  search: "",
  assigneeIds: [],
  statusCategories: [],
  groupIds: [],
  sortBy: "activity",
  sortDir: "desc",
  hasActivity: false,
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

export function getTrackerBoardFiltersStorageKey(
  trackerType: string,
  projectSlug?: string | null
): string {
  const normalizedProjectSlug = String(projectSlug ?? "").trim().toLowerCase();
  const prefix = `${TRACKER_BOARD_FILTERS_STORAGE_PREFIX}:${trackerType}`;
  return normalizedProjectSlug
    ? `${prefix}:${normalizedProjectSlug}`
    : `${prefix}:global`;
}

export function loadTrackerBoardFilters(
  trackerType: string,
  projectSlug?: string | null
): TrackerBoardFilters {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_TRACKER_BOARD_FILTERS };
  }

  const raw = window.localStorage.getItem(getTrackerBoardFiltersStorageKey(trackerType, projectSlug));
  if (!raw) {
    return { ...DEFAULT_TRACKER_BOARD_FILTERS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TrackerBoardFilters>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : DEFAULT_TRACKER_BOARD_FILTERS.search,
      assigneeIds: normalizeStringArray(parsed.assigneeIds),
      statusCategories: normalizeStringArray(parsed.statusCategories),
      groupIds: normalizeStringArray(parsed.groupIds),
      sortBy: ["activity", "identifier", "status", "created"].includes(parsed.sortBy as string)
        ? (parsed.sortBy as TrackerBoardFilters["sortBy"])
        : DEFAULT_TRACKER_BOARD_FILTERS.sortBy,
      sortDir: ["asc", "desc"].includes(parsed.sortDir as string)
        ? (parsed.sortDir as TrackerBoardFilters["sortDir"])
        : DEFAULT_TRACKER_BOARD_FILTERS.sortDir,
      hasActivity: typeof parsed.hasActivity === "boolean"
        ? parsed.hasActivity
        : DEFAULT_TRACKER_BOARD_FILTERS.hasActivity,
    };
  } catch {
    return { ...DEFAULT_TRACKER_BOARD_FILTERS };
  }
}

export function persistTrackerBoardFilters(
  trackerType: string,
  projectSlug: string | null | undefined,
  filters: TrackerBoardFilters
): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      getTrackerBoardFiltersStorageKey(trackerType, projectSlug),
      JSON.stringify({
        search: filters.search,
        assigneeIds: normalizeStringArray(filters.assigneeIds),
        statusCategories: normalizeStringArray(filters.statusCategories),
        groupIds: normalizeStringArray(filters.groupIds),
        sortBy: filters.sortBy || "activity",
        sortDir: filters.sortDir || "desc",
        hasActivity: !!filters.hasActivity,
      })
    );
  } catch {
    // ignore storage errors
  }
}
const LINEAR_BOARD_FILTERS_STORAGE_PREFIX = "agx-linear:boardFilters";

export interface LinearBoardFilters {
  search: string;
  assigneeIds: string[];
  statuses: string[];
  teamId: string;
  cycleId: string;
}

const DEFAULT_LINEAR_BOARD_FILTERS: LinearBoardFilters = {
  search: "",
  assigneeIds: [],
  statuses: [],
  teamId: "",
  cycleId: "",
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

export function getLinearBoardFiltersStorageKey(projectSlug?: string | null): string {
  const normalizedProjectSlug = String(projectSlug ?? "").trim().toLowerCase();
  return normalizedProjectSlug
    ? `${LINEAR_BOARD_FILTERS_STORAGE_PREFIX}:${normalizedProjectSlug}`
    : `${LINEAR_BOARD_FILTERS_STORAGE_PREFIX}:global`;
}

export function loadLinearBoardFilters(projectSlug?: string | null): LinearBoardFilters {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_LINEAR_BOARD_FILTERS };
  }

  const raw = window.localStorage.getItem(getLinearBoardFiltersStorageKey(projectSlug));
  if (!raw) {
    return { ...DEFAULT_LINEAR_BOARD_FILTERS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LinearBoardFilters>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : DEFAULT_LINEAR_BOARD_FILTERS.search,
      assigneeIds: normalizeStringArray(parsed.assigneeIds),
      statuses: normalizeStringArray(parsed.statuses),
      teamId: typeof parsed.teamId === "string" ? parsed.teamId : DEFAULT_LINEAR_BOARD_FILTERS.teamId,
      cycleId: typeof parsed.cycleId === "string" ? parsed.cycleId : DEFAULT_LINEAR_BOARD_FILTERS.cycleId,
    };
  } catch {
    return { ...DEFAULT_LINEAR_BOARD_FILTERS };
  }
}

export function persistLinearBoardFilters(
  projectSlug: string | null | undefined,
  filters: LinearBoardFilters
): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      getLinearBoardFiltersStorageKey(projectSlug),
      JSON.stringify({
        search: filters.search,
        assigneeIds: normalizeStringArray(filters.assigneeIds),
        statuses: normalizeStringArray(filters.statuses),
        teamId: String(filters.teamId || ""),
        cycleId: String(filters.cycleId || ""),
      })
    );
  } catch {
    // ignore storage errors
  }
}

export interface UserPreferences {
  threadSidebarVisible: boolean;
  workspaceRoots: string[];
  homeSearchConsent: boolean;
  hasCompletedFirstRun: boolean;
  fileIgnorePatterns: string[];
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  threadSidebarVisible: false,
  workspaceRoots: [],
  homeSearchConsent: false,
  hasCompletedFirstRun: false,
  fileIgnorePatterns: [],
};

export function sanitizeUserPreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== "object") {
    return DEFAULT_USER_PREFERENCES;
  }

  const candidate = input as Record<string, unknown>;
  return {
    threadSidebarVisible:
      typeof candidate.threadSidebarVisible === "boolean"
        ? candidate.threadSidebarVisible
        : DEFAULT_USER_PREFERENCES.threadSidebarVisible,
    workspaceRoots: Array.isArray(candidate.workspaceRoots)
      ? candidate.workspaceRoots.filter((r) => typeof r === "string")
      : DEFAULT_USER_PREFERENCES.workspaceRoots,
    homeSearchConsent:
      typeof candidate.homeSearchConsent === "boolean"
        ? candidate.homeSearchConsent
        : DEFAULT_USER_PREFERENCES.homeSearchConsent,
    hasCompletedFirstRun:
      typeof candidate.hasCompletedFirstRun === "boolean"
        ? candidate.hasCompletedFirstRun
        : DEFAULT_USER_PREFERENCES.hasCompletedFirstRun,
    fileIgnorePatterns: Array.isArray(candidate.fileIgnorePatterns)
      ? candidate.fileIgnorePatterns.filter((p) => typeof p === "string")
      : DEFAULT_USER_PREFERENCES.fileIgnorePatterns,
  };
}

export function sanitizePartialUserPreferences(input: unknown): Partial<UserPreferences> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const candidate = input as Record<string, unknown>;
  const normalized: Partial<UserPreferences> = {};

  if (typeof candidate.threadSidebarVisible === "boolean") {
    normalized.threadSidebarVisible = candidate.threadSidebarVisible;
  }

  if (Array.isArray(candidate.workspaceRoots)) {
    normalized.workspaceRoots = candidate.workspaceRoots.filter((r) => typeof r === "string");
  }

  if (typeof candidate.homeSearchConsent === "boolean") {
    normalized.homeSearchConsent = candidate.homeSearchConsent;
  }

  if (typeof candidate.hasCompletedFirstRun === "boolean") {
    normalized.hasCompletedFirstRun = candidate.hasCompletedFirstRun;
  }

  if (Array.isArray(candidate.fileIgnorePatterns)) {
    normalized.fileIgnorePatterns = candidate.fileIgnorePatterns.filter((p) => typeof p === "string");
  }

  return normalized;
}

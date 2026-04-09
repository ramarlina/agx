import type { UserPreferences } from "@/types/userPreferences";
import { DEFAULT_USER_PREFERENCES, sanitizePartialUserPreferences } from "@/types/userPreferences";

let storedPreferences: UserPreferences = { ...DEFAULT_USER_PREFERENCES };

export function loadUserPreferences(): UserPreferences {
  return { ...storedPreferences };
}

export function saveUserPreferences(overrides: Partial<UserPreferences>): UserPreferences {
  const sanitized = sanitizePartialUserPreferences(overrides);
  if (Object.keys(sanitized).length === 0) {
    return { ...storedPreferences };
  }

  storedPreferences = { ...storedPreferences, ...sanitized };
  return { ...storedPreferences };
}

/**
 * @internal
 */
export function resetUserPreferencesForTests(): void {
  storedPreferences = { ...DEFAULT_USER_PREFERENCES };
}

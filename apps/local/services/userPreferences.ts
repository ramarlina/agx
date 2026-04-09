import type { UserPreferences } from "@/types/userPreferences";
import { sanitizeUserPreferences } from "@/types/userPreferences";

const USER_PREFERENCES_ENDPOINT = "/api/userPreferences";

function normalizeResponsePayload(response: Response): Promise<UserPreferences> {
  return response
    .json()
    .then((payload) => {
      if (payload && typeof payload === "object") {
        const candidate = payload as Record<string, unknown>;
        return sanitizeUserPreferences(candidate.preferences ?? payload);
      }
      return sanitizeUserPreferences(payload);
    })
    .catch(() => sanitizeUserPreferences(null));
}

function buildErrorMessage(response: Response) {
  return response.statusText || `Failed to reach ${USER_PREFERENCES_ENDPOINT} (${response.status})`;
}

export async function fetchUserPreferences(): Promise<UserPreferences> {
  const response = await fetch(USER_PREFERENCES_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(buildErrorMessage(response));
  }
  return normalizeResponsePayload(response);
}

export async function updateUserPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
  const response = await fetch(USER_PREFERENCES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ preferences }),
  });

  if (!response.ok) {
    throw new Error(buildErrorMessage(response));
  }

  return normalizeResponsePayload(response);
}

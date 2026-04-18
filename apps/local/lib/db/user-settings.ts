import { createAdminDbClient } from "../db-adapter";
import { isMissingRelationError } from "./shared";
import type { UserSettings, UserSettingsProvenance } from "./types";

function normalizeChangedAt(value?: string | null): string {
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error, "user_settings")) return null;
    throw error;
  }
  if (!data) return null;
  return data as UserSettings;
}

export async function upsertUserSettings(
  userId: string,
  input: {
    default_provider?: string | null;
    models?: Record<string, string> | null;
    provenance: UserSettingsProvenance;
    changed_at?: string | null;
  },
  options?: { onlyIfNewer?: boolean }
): Promise<{ settings: UserSettings; updated: boolean }> {
  const onlyIfNewer = options?.onlyIfNewer !== false;
  const incomingChangedAt = normalizeChangedAt(input.changed_at);

  const existing = await getUserSettings(userId);
  if (onlyIfNewer && existing?.changed_at) {
    const existingTs = Date.parse(existing.changed_at);
    const incomingTs = Date.parse(incomingChangedAt);
    if (Number.isFinite(existingTs) && Number.isFinite(incomingTs) && incomingTs <= existingTs) {
      return { settings: existing, updated: false };
    }
  }

  const payload: any = {
    user_id: userId,
    default_provider: input.default_provider ?? existing?.default_provider ?? null,
    models: input.models ?? existing?.models ?? {},
    provenance: input.provenance,
    changed_at: incomingChangedAt,
  };

  const db = createAdminDbClient();
  const { error: upsertError } = await db
    .from("user_settings")
    .upsert(payload, { onConflict: "user_id" });
  if (upsertError) throw upsertError;

  const after = await getUserSettings(userId);
  if (!after) throw new Error("Failed to load user_settings after upsert");
  return { settings: after, updated: true };
}


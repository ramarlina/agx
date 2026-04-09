"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUserPreferences, updateUserPreferences } from "@/services/userPreferences";
import type { UserPreferences } from "@/types/userPreferences";
import { DEFAULT_USER_PREFERENCES } from "@/types/userPreferences";

interface UseFirstRunResult {
  /** True while preferences are being fetched */
  loading: boolean;
  /** Current preferences */
  preferences: UserPreferences;
  /** Whether the first-run modal should be shown */
  showFirstRunModal: boolean;
  /** Call when the user saves/skips the modal */
  handleFirstRunSave: (patch: Partial<UserPreferences>) => Promise<void>;
  /** Programmatically open the first-run / workspace-setup modal */
  openModal: () => void;
}

export function useFirstRun(): UseFirstRunResult {
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [showFirstRunModal, setShowFirstRunModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await fetchUserPreferences();
        if (cancelled) return;
        setPreferences(prefs);
        if (!prefs.hasCompletedFirstRun) {
          setShowFirstRunModal(true);
        }
      } catch (err) {
        console.error("useFirstRun: failed to load preferences", err);
        // On error, surface the modal so the user can set up their workspace
        if (!cancelled) setShowFirstRunModal(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFirstRunSave = useCallback(
    async (patch: Partial<UserPreferences>) => {
      try {
        const updated = await updateUserPreferences(patch);
        setPreferences(updated);
      } catch (err) {
        console.error("useFirstRun: failed to save preferences", err);
        // Apply optimistically even if the API call fails
        setPreferences((prev) => ({ ...prev, ...patch }));
      } finally {
        setShowFirstRunModal(false);
      }
    },
    []
  );

  const openModal = useCallback(() => {
    setShowFirstRunModal(true);
  }, []);

  return { loading, preferences, showFirstRunModal, handleFirstRunSave, openModal };
}

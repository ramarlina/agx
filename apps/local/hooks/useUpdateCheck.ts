"use client";

import { useEffect, useState } from "react";
import { UI_POLL_UPDATE_CHECK_MS } from "@/lib/constants/timing";

interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
}

export function useUpdateCheck(): UpdateCheckResult {
  const [state, setState] = useState<UpdateCheckResult>({
    updateAvailable: false,
    latestVersion: null,
  });

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/update-check");
        if (!res.ok) return;
        const raw = await res.json();
        const updateAvailable = raw?.updateAvailable === true;
        const latestVersion = typeof raw?.latestVersion === "string" ? raw.latestVersion : null;
        setState({ updateAvailable, latestVersion });
      } catch {
        // fail silently
      }
    }

    void check();
    const id = setInterval(() => { void check(); }, UI_POLL_UPDATE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  return state;
}

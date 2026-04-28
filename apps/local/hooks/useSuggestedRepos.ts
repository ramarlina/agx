"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SuggestedRepo } from "@/lib/repo-suggestions";

interface SuggestedReposResponse {
  repos: SuggestedRepo[];
  scanning: boolean;
  scannedAt: number | null;
}

interface UseSuggestedReposArgs {
  projectSlug?: string | null;
  projectName?: string | null;
  limit?: number;
}

const POLL_INTERVAL_MS = 3000;

export function useSuggestedRepos({
  projectSlug,
  projectName,
  limit,
}: UseSuggestedReposArgs) {
  const [repos, setRepos] = useState<SuggestedRepo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectSlug) params.set("projectSlug", projectSlug);
    if (projectName) params.set("projectName", projectName);
    if (typeof limit === "number") params.set("limit", String(limit));

    const url = `/api/git/repos${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message =
        typeof body.error === "string" ? body.error : "Failed to fetch repo suggestions";
      throw new Error(message);
    }
    const data = (await response.json()) as SuggestedReposResponse;
    return data;
  }, [projectSlug, projectName, limit]);

  const fetchAndSchedule = useCallback(async () => {
    try {
      const data = await fetchOnce();
      if (cancelledRef.current) return;
      setRepos(data.repos);
      setScanning(data.scanning);
      setScannedAt(data.scannedAt);
      setError(null);

      if (data.scanning && data.repos.length === 0) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          void fetchAndSchedule();
        }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      if (!cancelledRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetchOnce]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchAndSchedule();
  }, [fetchAndSchedule]);

  useEffect(() => {
    cancelledRef.current = false;
    setIsLoading(true);
    void fetchAndSchedule();

    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchAndSchedule]);

  return {
    repos,
    scanning,
    scannedAt,
    isLoading,
    error,
    refetch,
  };
}

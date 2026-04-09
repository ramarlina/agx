"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildGraphSummary, type TaskGraphSummary } from "@/components/graph/graph-derived";
import type { ExecutionGraph } from "@/src/graph/types";

interface UseTaskGraphSummaryResult {
  summary: TaskGraphSummary | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const summaryCache = new Map<string, TaskGraphSummary | null>();
const inflight = new Map<string, Promise<TaskGraphSummary | null>>();

async function fetchSummary(taskId: string): Promise<TaskGraphSummary | null> {
  const existing = summaryCache.get(taskId);
  if (existing !== undefined) {
    return existing;
  }

  const pending = inflight.get(taskId);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const response = await fetch(`/api/tasks/${taskId}/graph`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 404) {
      summaryCache.set(taskId, null);
      return null;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Failed to fetch graph summary (${response.status})`);
    }

    const graph = (payload?.graph ?? null) as ExecutionGraph | null;
    const summary = graph ? buildGraphSummary(graph) : null;
    summaryCache.set(taskId, summary);
    return summary;
  })();

  inflight.set(taskId, request);

  try {
    return await request;
  } finally {
    inflight.delete(taskId);
  }
}

export function useTaskGraphSummary(taskId: string | null | undefined): UseTaskGraphSummaryResult {
  const initialSummary = useMemo(() => {
    if (!taskId) {
      return null;
    }
    return summaryCache.get(taskId) ?? null;
  }, [taskId]);

  const [summary, setSummary] = useState<TaskGraphSummary | null>(initialSummary);
  const [isLoading, setIsLoading] = useState(Boolean(taskId) && initialSummary === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId) {
      setSummary(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nextSummary = await fetchSummary(taskId);
      setSummary(nextSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph summary");
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    summary,
    isLoading,
    error,
    refresh: load,
  };
}

export function invalidateTaskGraphSummary(taskId: string): void {
  summaryCache.delete(taskId);
}

/** Read a previously fetched summary from cache (no fetch). */
export function getCachedGraphSummary(taskId: string): TaskGraphSummary | null {
  return summaryCache.get(taskId) ?? null;
}

/** Pre-warm the summary cache for a batch of tasks. */
export async function prefetchGraphSummaries(taskIds: string[]): Promise<void> {
  await Promise.allSettled(taskIds.map((id) => fetchSummary(id)));
}

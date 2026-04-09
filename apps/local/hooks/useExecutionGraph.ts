"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { ExecutionGraph } from "@/src/graph/types";

interface UseExecutionGraphResult {
  graph: ExecutionGraph | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setGraph: Dispatch<SetStateAction<ExecutionGraph | null>>;
}

export function useExecutionGraph(taskId: string | null | undefined): UseExecutionGraphResult {
  const [graph, setGraph] = useState<ExecutionGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!taskId) {
      setGraph(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/graph`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 404) {
        setGraph(null);
        setError(null);
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to fetch graph (${response.status})`);
      }

      setGraph((payload?.graph ?? null) as ExecutionGraph | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph");
      setGraph(null);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  return {
    graph,
    isLoading,
    error,
    refetch: fetchGraph,
    setGraph,
  };
}

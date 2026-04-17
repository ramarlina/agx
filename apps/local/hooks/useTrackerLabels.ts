"use client";

import { useState, useEffect, useCallback } from "react";

export interface LabelEntry {
  name: string;
  color: string | null;
  defined: boolean;
}

export interface LabelDefinition {
  id: string;
  name: string;
  color: string | null;
}

export function useTrackerLabels(trackerType: string, projectId: string | undefined) {
  const [labels, setLabels] = useState<LabelEntry[]>([]);
  const [definitions, setDefinitions] = useState<LabelDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLabels = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trackers/${encodeURIComponent(trackerType)}/labels?projectId=${encodeURIComponent(projectId)}`
      );
      const data = await res.json();
      setLabels(Array.isArray(data.labels) ? data.labels : []);
      setDefinitions(Array.isArray(data.definitions) ? data.definitions : []);
    } catch {}
    setLoading(false);
  }, [trackerType, projectId]);

  useEffect(() => {
    void fetchLabels();
  }, [fetchLabels]);

  const createDefinition = useCallback(
    async (name: string, color?: string) => {
      if (!projectId) return;
      try {
        const res = await fetch(`/api/trackers/${encodeURIComponent(trackerType)}/labels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, name, color }),
        });
        if (res.ok) {
          await fetchLabels();
        }
      } catch {}
    },
    [trackerType, projectId, fetchLabels]
  );

  const deleteDefinition = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        const res = await fetch(
          `/api/trackers/${encodeURIComponent(trackerType)}/labels/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          await fetchLabels();
        }
      } catch {}
    },
    [trackerType, projectId, fetchLabels]
  );

  return { labels, definitions, loading, refresh: fetchLabels, createDefinition, deleteDefinition };
}

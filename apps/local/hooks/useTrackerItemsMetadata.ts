"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ItemMetadata {
  labels: string[];
  estimate: number | null;
}

export function useTrackerItemsMetadata(
  trackerType: string,
  projectId: string | undefined,
  issueIds: string[]
) {
  const [metadataMap, setMetadataMap] = useState<Map<string, ItemMetadata>>(new Map());
  const [loading, setLoading] = useState(false);
  const prevIdsRef = useRef<string>("");

  const fetchAll = useCallback(async () => {
    if (!projectId || issueIds.length === 0) {
      setMetadataMap(new Map());
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trackers/${encodeURIComponent(trackerType)}/metadata/bulk?projectId=${encodeURIComponent(projectId)}&issueIds=${issueIds.map(encodeURIComponent).join(",")}`
      );
      const data = await res.json();
      const map = new Map<string, ItemMetadata>();
      for (const [id, meta] of Object.entries(data)) {
        const m = meta as { labels?: string[]; estimate?: number | null };
        map.set(id, {
          labels: Array.isArray(m.labels) ? m.labels : [],
          estimate: typeof m.estimate === "number" ? m.estimate : null,
        });
      }
      setMetadataMap(map);
    } catch {}
    setLoading(false);
  }, [trackerType, projectId, issueIds]);

  useEffect(() => {
    const idsKey = issueIds.join(",");
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;
    void fetchAll();
  }, [fetchAll, issueIds]);

  return { metadataMap, loading, refresh: fetchAll };
}

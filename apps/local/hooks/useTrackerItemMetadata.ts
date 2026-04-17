"use client";

import { useState, useEffect, useCallback } from "react";

interface ItemMetadata {
  labels: string[];
  estimate: number | null;
}

export function useTrackerItemMetadata(
  trackerType: string,
  projectId: string | undefined,
  issueId: string | null
) {
  const [metadata, setMetadata] = useState<ItemMetadata>({ labels: [], estimate: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !issueId) {
      setMetadata({ labels: [], estimate: null });
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/trackers/${encodeURIComponent(trackerType)}/metadata?projectId=${encodeURIComponent(projectId)}&issueId=${encodeURIComponent(issueId)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setMetadata({
            labels: Array.isArray(data.labels) ? data.labels : [],
            estimate: typeof data.estimate === "number" ? data.estimate : null,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [trackerType, projectId, issueId]);

  const update = useCallback(
    async (patch: { labels?: string[]; estimate?: number | null }) => {
      if (!projectId || !issueId) return;
      try {
        const res = await fetch(
          `/api/trackers/${encodeURIComponent(trackerType)}/metadata?projectId=${encodeURIComponent(projectId)}&issueId=${encodeURIComponent(issueId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        setMetadata({
          labels: Array.isArray(data.labels) ? data.labels : metadata.labels,
          estimate: typeof data.estimate === "number" ? data.estimate : null,
        });
      } catch {}
    },
    [trackerType, projectId, issueId, metadata.labels]
  );

  return { metadata, loading, update };
}

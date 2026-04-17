"use client";

import { useEffect, useState } from "react";

export interface TrackerItemMention {
  id: string;
  identifier: string;
  title: string;
  status: string;
  url?: string;
}

interface UseTrackerItemMentionsOptions {
  projectId: string;
  projectSlug?: string;
  enabled?: boolean;
  limit?: number;
}

interface UseTrackerItemMentionsReturn {
  issues: TrackerItemMention[];
  loading: boolean;
}

export function useTrackerItemMentions({
  projectId,
  projectSlug,
  enabled = true,
  limit = 500,
}: UseTrackerItemMentionsOptions): UseTrackerItemMentionsReturn {
  const [issues, setIssues] = useState<TrackerItemMention[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setIssues([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    params.set("limit", String(limit));
    if (projectSlug) {
      params.set("projectSlug", projectSlug);
    }

    setLoading(true);
    fetch(`/api/trackers/linear/items?${params.toString()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!cancelled) {
          setIssues(Array.isArray(data.issues) ? data.issues : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIssues([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, limit, projectId, projectSlug]);

  return { issues, loading };
}

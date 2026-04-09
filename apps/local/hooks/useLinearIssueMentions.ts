"use client";

import { useEffect, useState } from "react";
import type { LinearIssue } from "@/hooks/useLinearIssues";

interface UseLinearIssueMentionsOptions {
  projectSlug?: string;
  enabled?: boolean;
  limit?: number;
}

interface UseLinearIssueMentionsReturn {
  issues: LinearIssue[];
  loading: boolean;
}

export function useLinearIssueMentions({
  projectSlug,
  enabled = true,
  limit = 500,
}: UseLinearIssueMentionsOptions = {}): UseLinearIssueMentionsReturn {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIssues([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (projectSlug) {
      params.set("projectSlug", projectSlug);
    }

    setLoading(true);
    fetch(`/api/linear/issues?${params.toString()}`)
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
  }, [enabled, limit, projectSlug]);

  return { issues, loading };
}

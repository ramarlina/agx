"use client";

import { useEffect, useState } from "react";

export interface IssueStatsEntry {
  sessions: number;
  messages: number;
}

export function useTrackerIssueStats(
  trackerType: string,
  projectId?: string,
): {
  issueStats: Map<string, IssueStatsEntry>;
} {
  const [issueStats, setIssueStats] = useState<Map<string, IssueStatsEntry>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const params = new URLSearchParams();
        if (projectId) params.set("projectId", projectId);
        const res = await fetch(
          `/api/trackers/${trackerType}/stats?${params}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const map = new Map<string, IssueStatsEntry>();
        for (const entry of data.stats ?? []) {
          map.set(entry.issueId, {
            sessions: entry.sessions,
            messages: entry.messages,
          });
        }
        if (!cancelled) setIssueStats(map);
      } catch {
        // ignore
      }
    }

    void fetchStats();
    const interval = setInterval(() => void fetchStats(), 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trackerType, projectId]);

  return { issueStats };
}

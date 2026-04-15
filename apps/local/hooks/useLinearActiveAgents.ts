"use client";

import { useEffect, useState } from "react";

export function useLinearActiveAgents(projectId?: string): {
  issueActiveAgents: Map<string, Array<{ agentId: string; agentName: string }>>;
} {
  const [issueActiveAgents, setIssueActiveAgents] = useState<Map<string, Array<{ agentId: string; agentName: string }>>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function fetchActiveAgents() {
      try {
        const params = new URLSearchParams();
        if (projectId) params.set("projectId", projectId);
        const res = await fetch(`/api/linear/issues/active-agents?${params}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const map = new Map<string, Array<{ agentId: string; agentName: string }>>();
        for (const entry of data.agents ?? []) {
          const list = map.get(entry.issueId) ?? [];
          list.push({ agentId: entry.agentId, agentName: entry.agentName });
          map.set(entry.issueId, list);
        }
        if (!cancelled) setIssueActiveAgents(map);
      } catch {
        // ignore
      }
    }

    void fetchActiveAgents();
    const interval = setInterval(() => void fetchActiveAgents(), 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId]);

  return { issueActiveAgents };
}

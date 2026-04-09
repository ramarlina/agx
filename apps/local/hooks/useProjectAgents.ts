"use client";

import { useCallback, useEffect, useState } from "react";

export interface ProjectAgentEntry {
  project_id: string;
  agent_id: string;
  routing_order: number;
  created_at: string;
}

export function useProjectAgents(projectId: string | null) {
  const [agents, setAgents] = useState<ProjectAgentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    if (!projectId) {
      setAgents([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`);
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const addAgent = useCallback(async (agentId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // silent
    }
  }, [projectId]);

  const removeAgent = useCallback(async (agentId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/agents?agentId=${agentId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // silent
    }
  }, [projectId]);

  const reorderAgents = useCallback(async (orderedAgentIds: string[]) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedAgentIds }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // silent
    }
  }, [projectId]);

  return {
    agents,
    isLoading,
    addAgent,
    removeAgent,
    reorderAgents,
    refresh: fetchAgents,
  };
}

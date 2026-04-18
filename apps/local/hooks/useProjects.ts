"use client";

import { useCallback, useEffect, useState } from "react";

export interface ProjectRepo {
  id: string;
  project_id: string;
  name: string;
  path?: string;
  git_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id?: string;
  name: string;
  slug: string;
  description?: string;
  metadata: Record<string, unknown>;
  ci_cd_info?: string;
  workflow_id?: string | null;
  identifier_prefix?: string | null;
  next_identifier?: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithRepos extends Project {
  repos: ProjectRepo[];
}

export interface ProjectAgentRef {
  project_id: string;
  agent_id: string;
  routing_order: number;
  created_at: string;
}

export interface ProjectWithAgents extends Project {
  repos: ProjectRepo[];
  agents: ProjectAgentRef[];
  thread_ids: string[];
  /** @deprecated Legacy alias retained for compatibility during the workspace -> project rename. */
  workspace_ids?: string[];
  /** @deprecated Compatibility field from team migration. Projects don't have a default concept. */
  is_default?: number;
}

export interface ProjectRepoInput {
  id?: string;
  name: string;
  path?: string;
  git_url?: string;
  notes?: string;
}

export interface CreateProjectPayload {
  name: string;
  slug?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ci_cd_info?: string;
  repos?: ProjectRepoInput[];
}

export interface UpdateProjectPayload {
  name?: string;
  slug?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ci_cd_info?: string;
  repos?: ProjectRepoInput[];
  identifier_prefix?: string | null;
}

interface ProjectAgentData {
  project_id: string;
  agent_id: string;
  routing_order: number;
  created_at: string;
}

interface ProjectThreadData {
  project_id: string;
  thread_id: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectWithRepos[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) {
        throw new Error("Failed to fetch projects");
      }
      const data = await response.json();
      setProjects(data.projects ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = useCallback(async (payload: CreateProjectPayload) => {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create project");
    }
    const data = await response.json();
    const project: ProjectWithRepos = data.project;
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  const updateProject = useCallback(async (projectId: string, payload: UpdateProjectPayload) => {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update project");
    }
    const data = await response.json();
    const project: ProjectWithRepos = data.project;
    setProjects((prev) => prev.map((p) => (p.id === projectId ? project : p)));
    return project;
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Failed to delete project");
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  return {
    projects,
    isLoading,
    error,
    refetch: fetchProjects,
    createProject,
    updateProject,
    deleteProject,
  };
}

/**
 * useProjectsWithAgents — fetches projects and their agent rosters.
 * Replaces the old useTeams hook. Projects are the single top-level entity;
 * agent routing is managed via project_agents.
 */
export function useProjectsWithAgents() {
  const [projects, setProjects] = useState<ProjectWithAgents[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const projectsRes = await fetch("/api/projects");
      if (!projectsRes.ok) return;
      const { projects: rawProjects } = (await projectsRes.json()) as { projects: ProjectWithRepos[] };

      const mapped = await Promise.all(
        (rawProjects ?? []).map(async (p): Promise<ProjectWithAgents> => {
          let agents: ProjectAgentData[] = [];
          let threadIds: string[] = [];
          try {
            const [aRes, tRes] = await Promise.all([
              fetch(`/api/projects/${p.id}/agents`),
              fetch(`/api/projects/${p.id}/threads`),
            ]);
            if (aRes.ok) agents = ((await aRes.json()).agents ?? []) as ProjectAgentData[];
            if (tRes.ok) threadIds = ((await tRes.json()).threads ?? []).map((t: ProjectThreadData) => t.thread_id);
          } catch { /* silent */ }

          return {
            ...p,
            repos: p.repos ?? [],
            agents: agents.map((a) => ({
              project_id: p.id,
              agent_id: a.agent_id,
              routing_order: a.routing_order,
              created_at: a.created_at,
            })),
            thread_ids: threadIds,
            workspace_ids: threadIds,
          };
        })
      );

      setProjects(mapped);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const createProject = useCallback(async (
    payload: string | CreateProjectPayload,
    threadIds?: string | string[]
  ): Promise<ProjectWithAgents | null> => {
    try {
      const basePayload = typeof payload === "string" ? { name: payload } : payload;
      const name = basePayload.name.trim();
      const slug = (basePayload.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).trim();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload, name, slug }),
      });
      if (!res.ok) return null;
      const { project } = await res.json();

      const ids = Array.isArray(threadIds) ? threadIds : threadIds ? [threadIds] : [];
      for (const tid of ids) {
        await fetch(`/api/projects/${project.id}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: tid }),
        }).catch((err) => console.warn('[useProjects] link thread failed:', err));
      }

      const result: ProjectWithAgents = {
        ...project,
        repos: project.repos ?? [],
        agents: [],
        thread_ids: ids,
        workspace_ids: ids,
      };
      setProjects((prev) => [...prev, result].sort((a, b) => a.name.localeCompare(b.name)));
      return result;
    } catch {
      return null;
    }
  }, []);

  const renameProject = useCallback(async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name } : p)).sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch { /* silent */ }
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch { /* silent */ }
  }, []);

  const updateProject = useCallback(async (projectId: string, payload: UpdateProjectPayload) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update project");
      }
      const data = await response.json();
      const project = data.project as ProjectWithRepos;
      setProjects((prev) =>
        prev.map((item) =>
          item.id === projectId
            ? {
                ...item,
                ...project,
                repos: project.repos ?? item.repos,
              }
            : item
        )
      );
      return project;
    } catch {
      return null;
    }
  }, []);

  const addAgent = useCallback(async (projectId: string, agentId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const agents = (data.agents ?? []).map((a: ProjectAgentData) => ({
        project_id: projectId,
        agent_id: a.agent_id,
        routing_order: a.routing_order,
        created_at: a.created_at,
      }));
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, agents } : p))
      );
    } catch { /* silent */ }
  }, []);

  const removeAgent = useCallback(async (projectId: string, agentId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents?agentId=${agentId}`, { method: "DELETE" });
      if (!res.ok) return;
      const data = await res.json();
      const agents = (data.agents ?? []).map((a: ProjectAgentData) => ({
        project_id: projectId,
        agent_id: a.agent_id,
        routing_order: a.routing_order,
        created_at: a.created_at,
      }));
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, agents } : p))
      );
    } catch { /* silent */ }
  }, []);

  const reorderAgents = useCallback(async (projectId: string, orderedAgentIds: string[]) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedAgentIds }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const agents = (data.agents ?? []).map((a: ProjectAgentData) => ({
        project_id: projectId,
        agent_id: a.agent_id,
        routing_order: a.routing_order,
        created_at: a.created_at,
      }));
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, agents } : p))
      );
    } catch { /* silent */ }
  }, []);

  const moveAgent = useCallback(async (agentId: string, fromProjectId: string, toProjectId: string) => {
    try {
      await fetch(`/api/projects/${fromProjectId}/agents?agentId=${agentId}`, { method: "DELETE" });
      await fetch(`/api/projects/${toProjectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      await fetchProjects();
    } catch { /* silent */ }
  }, [fetchProjects]);

  return {
    projects,
    isLoading,
    createProject,
    updateProject,
    renameProject,
    deleteProject,
    addAgent,
    removeAgent,
    reorderAgents,
    moveAgent,
    refresh: fetchProjects,
  };
}

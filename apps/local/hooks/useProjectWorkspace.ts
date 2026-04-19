"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceEntry } from "@/lib/db/types";
import type { ProjectWorkspace } from "@/lib/project-workspace";
import { countWorkspaceEntries } from "@/lib/project-workspace";

interface CreateWorkspaceEntryInput {
  category: string;
  name: string;
  path?: string | null;
  purpose?: string | null;
}

interface UpdateWorkspaceEntryInput {
  name?: string;
  path?: string | null;
  purpose?: string | null;
  sort_order?: number;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export function useProjectWorkspace(projectId: string) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchWorkspace = useCallback(async () => {
    if (!projectId) {
      setWorkspace({});
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/workspace`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to fetch workspace map"));
      }
      const data = await response.json();
      setWorkspace(data.workspace ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  const createEntry = useCallback(
    async (input: CreateWorkspaceEntryInput) => {
      const response = await fetch(`/api/projects/${projectId}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create workspace entry"));
      }
      const data = await response.json();
      await fetchWorkspace();
      return data.entry as WorkspaceEntry;
    },
    [fetchWorkspace, projectId],
  );

  const updateEntry = useCallback(
    async (entryId: string, updates: UpdateWorkspaceEntryInput) => {
      const response = await fetch(`/api/projects/${projectId}/workspace/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update workspace entry"));
      }
      const data = await response.json();
      await fetchWorkspace();
      return data.entry as WorkspaceEntry;
    },
    [fetchWorkspace, projectId],
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      const response = await fetch(`/api/projects/${projectId}/workspace/${entryId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete workspace entry"));
      }
      await fetchWorkspace();
    },
    [fetchWorkspace, projectId],
  );

  return {
    workspace,
    entryCount: countWorkspaceEntries(workspace),
    isLoading,
    error,
    refetch: fetchWorkspace,
    createEntry,
    updateEntry,
    deleteEntry,
  };
}

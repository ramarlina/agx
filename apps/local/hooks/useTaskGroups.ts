"use client";

import { useCallback, useEffect, useState } from "react";

export interface TaskGroup {
  id: string;
  project_id: string;
  name: string;
  position: number;
  collapsed: number;
  task_ids: string[];
  created_at: string;
  updated_at: string;
}

export function useTaskGroups(projectId: string | null | undefined) {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/task-groups?project_id=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch (err) {
      console.error("useTaskGroups fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const createGroup = useCallback(
    async (name: string, taskIds: string[]): Promise<TaskGroup | null> => {
      if (!projectId) return null;
      try {
        const res = await fetch("/api/task-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, name, task_ids: taskIds }),
        });
        if (!res.ok) throw new Error("Failed to create group");
        const data = await res.json();
        await fetchGroups();
        return data.group;
      } catch (err) {
        console.error("createGroup error:", err);
        return null;
      }
    },
    [projectId, fetchGroups],
  );

  const updateGroup = useCallback(
    async (groupId: string, updates: { name?: string; position?: number; collapsed?: boolean }) => {
      try {
        const res = await fetch(`/api/task-groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update group");
        await fetchGroups();
      } catch (err) {
        console.error("updateGroup error:", err);
      }
    },
    [fetchGroups],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      try {
        const res = await fetch(`/api/task-groups/${groupId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete group");
        await fetchGroups();
      } catch (err) {
        console.error("deleteGroup error:", err);
      }
    },
    [fetchGroups],
  );

  const addTasksToGroup = useCallback(
    async (groupId: string, taskIds: string[]) => {
      try {
        const res = await fetch(`/api/task-groups/${groupId}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_ids: taskIds }),
        });
        if (!res.ok) throw new Error("Failed to assign tasks");
        await fetchGroups();
      } catch (err) {
        console.error("addTasksToGroup error:", err);
      }
    },
    [fetchGroups],
  );

  const removeTaskFromGroup = useCallback(
    async (groupId: string, taskId: string) => {
      try {
        const res = await fetch(
          `/api/task-groups/${groupId}/tasks?task_id=${encodeURIComponent(taskId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Failed to remove task");
        await fetchGroups();
      } catch (err) {
        console.error("removeTaskFromGroup error:", err);
      }
    },
    [fetchGroups],
  );

  return {
    groups,
    isLoading,
    refetch: fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addTasksToGroup,
    removeTaskFromGroup,
  };
}

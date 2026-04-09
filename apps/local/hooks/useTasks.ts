"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createDbClient } from "@/lib/db-client";
import { Task } from "@/components/TaskCard";

interface UseTasksOptions {
  project?: string;
  status?: string;
  orphan?: boolean;
  realtime?: boolean;
}

export function useTasks(options: UseTasksOptions = {}) {
  const realtimeDisabled = process.env.NEXT_PUBLIC_AGX_BOARD_DISABLE_AUTH === "1";
  const projectFilter = options.project;
  const statusFilter = options.status;
  const orphanFilter = options.orphan;
  const realtimeEnabled = options.realtime;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<Error | null>(null);

  const normalizeDependsOn = useCallback((input: unknown): string[] => {
    if (!input) return [];
    if (Array.isArray(input)) {
      return Array.from(new Set(input.map((entry) => String(entry || "").trim()).filter(Boolean)));
    }
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return Array.from(new Set(parsed.map((entry) => String(entry || "").trim()).filter(Boolean)));
        }
      } catch {
        // Fallback to comma-separated.
      }
      return Array.from(new Set(trimmed.split(",").map((entry) => entry.trim()).filter(Boolean)));
    }
    return [];
  }, []);

  const extractDependsOnFromContent = useCallback((content: string): string[] => {
    const match = String(content || "").match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return [];
    const line = match[1]
      .split("\n")
      .find((entry) => entry.trim().toLowerCase().startsWith("depends_on:"));
    if (!line) return [];
    const raw = line.slice(line.indexOf(":") + 1).trim();
    return normalizeDependsOn(raw);
  }, [normalizeDependsOn]);

  const withDependsOnFallback = useCallback((task: Task, previous?: Task): Task => {
    const direct = normalizeDependsOn((task as any).depends_on);
    if (direct.length > 0) {
      return { ...task, depends_on: direct };
    }
    const fromContent = typeof task?.content === "string" ? extractDependsOnFromContent(task.content) : [];
    if (fromContent.length > 0) {
      return { ...task, depends_on: fromContent };
    }
    const fromPrevious = normalizeDependsOn((previous as any)?.depends_on);
    if (fromPrevious.length > 0) {
      return { ...task, depends_on: fromPrevious };
    }
    return task;
  }, [extractDependsOnFromContent, normalizeDependsOn]);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set("project", projectFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (orphanFilter) params.set("orphan", "1");

      const response = await fetch(`/api/tasks?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch tasks");
      }

      const data = await response.json();
      const nextTasks = Array.isArray(data.tasks)
        ? data.tasks.map((task: Task) => withDependsOnFallback(task))
        : [];
      setTasks(nextTasks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [projectFilter, statusFilter, orphanFilter]);

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Polling fallback when realtime is disabled
  useEffect(() => {
    if (!realtimeDisabled) return;
    if (!realtimeEnabled) return;
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [realtimeDisabled, realtimeEnabled, fetchTasks]);

  // Real-time updates
  useEffect(() => {
    if (realtimeDisabled) return;
    if (!realtimeEnabled) return;

    const db = createDbClient();

    const channel = db
      .channel("tasks-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
        },
        (payload: any) => {
          if (payload.eventType === "INSERT") {
            setTasks((prev) => {
              const newTask = withDependsOnFallback(payload.new as Task);
              // Avoid duplicates (in case optimistic update already added it)
              if (prev.some(t => t.id === newTask.id)) {
                return prev;
              }
              return [newTask, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === (payload.new as Task).id
                  ? withDependsOnFallback(payload.new as Task, t)
                  : t
              )
            );
          } else if (payload.eventType === "DELETE") {
            setTasks((prev) =>
              prev.filter((t) => t.id !== (payload.old as { id: string }).id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [realtimeEnabled, realtimeDisabled]);

  // Poll for task updates (replaces SSE stream)
  useEffect(() => {
    if (realtimeDisabled) return;
    if (!realtimeEnabled) return;
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [realtimeEnabled, realtimeDisabled, fetchTasks]);

  const createTask = useCallback(async (
    content: string,
    swarmModels?: Array<{ provider: string; model: string }> | null
  ): Promise<Task> => {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, swarm_models: swarmModels }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create task");
    }

    const { task } = await response.json();
    const hydrated = withDependsOnFallback(task);
    // Optimistically add to local state immediately
    // Realtime will deduplicate if/when the INSERT event arrives
    setTasks((prev) => {
      // Check if task already exists (in case realtime was faster)
      if (prev.some(t => t.id === hydrated.id)) {
        return prev;
      }
      return [hydrated, ...prev];
    });
    return hydrated;
  }, [options.realtime, withDependsOnFallback]);

  const updateTask = useCallback(async (
    taskId: string,
    updates: Partial<Task>
  ): Promise<Task> => {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      let data: any = null;
      if (typeof (response as any).json === "function") {
        data = await response.json().catch(() => null);
      }
      throw new Error(
        data?.error ||
          data?.details ||
          `Failed to update task (${response.status} ${response.statusText || "Error"})`
      );
    }

    const { task } = await response.json();
    // Optimistically update local state immediately
    // Realtime UPDATE event will overwrite with server state
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? withDependsOnFallback({ ...t, ...task }, t) : t))
    );
    return withDependsOnFallback(task);
  }, [options.realtime, withDependsOnFallback]);

  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete task");
    }

    // Optimistically remove from local state immediately
    // Realtime DELETE event will confirm removal
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, [options.realtime]);

  const completeTaskStage = useCallback(async (args: {
    taskId: string;
    decision: "done" | "blocked" | "not_done" | "failed";
    final_result: string;
    explanation: string;
    log?: string;
  }): Promise<Task> => {
    const response = await fetch("/api/queue/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to complete task stage");
    }

    const { task } = await response.json();
    // Optimistically update local state immediately
    setTasks((prev) =>
      prev.map((t) => (t.id === args.taskId ? withDependsOnFallback({ ...t, ...task }, t) : t))
    );
    return withDependsOnFallback(task);
  }, [options.realtime, withDependsOnFallback]);

  const cancelWorkflow = useCallback(async (args: {
    taskId: string;
    reason?: string;
  }) => {
    setCancellingTaskId(args.taskId);
    setCancelError(null);

    try {
      const response = await fetch(`/api/orchestrator/tasks/${args.taskId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.reason ? { reason: args.reason } : {}),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data?.error || "Failed to cancel workflow";
        throw new Error(message);
      }

      return response.json();
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error("Failed to cancel workflow");
      setCancelError(normalized);
      throw normalized;
    } finally {
      setCancellingTaskId(null);
    }
  }, []);

  const fetchTask = useCallback(async (taskId: string): Promise<Task> => {
    const response = await fetch(`/api/tasks/${taskId}`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || "Failed to fetch task details");
    }

    return withDependsOnFallback(data?.task);
  }, [withDependsOnFallback]);

  const assignOrphanTasksToProject = useCallback(async (projectId: string): Promise<{ updatedCount: number; taskIds: string[] }> => {
    const response = await fetch("/api/tasks/assign-orphans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to assign orphan tasks");
    }

    await fetchTasks();
    return {
      updatedCount: Number(data?.updatedCount || 0),
      taskIds: Array.isArray(data?.taskIds) ? data.taskIds : [],
    };
  }, [fetchTasks]);

  return {
    tasks,
    isLoading,
    error,
    cancellingTaskId,
    isCancelling: Boolean(cancellingTaskId),
    cancelError,
    refetch: fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    completeTaskStage,
    cancelWorkflow,
    fetchTask,
    assignOrphanTasksToProject,
  };
}

// Hook for task comments
export function useTaskComments(taskId: string | null) {
  const realtimeDisabled = process.env.NEXT_PUBLIC_AGX_BOARD_DISABLE_AUTH === "1";
  const [comments, setComments] = useState<Array<{
    id: string;
    task_id: string;
    author_type?: "user" | "agent";
    author_id?: string;
    content: string;
    created_at: string;
    deleted_at?: string | null;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!taskId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments || []);
      }
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Real-time comment updates
  useEffect(() => {
    if (realtimeDisabled) return;
    if (!taskId) return;

    const db = createDbClient();

    const channel = db
      .channel(`task-comments-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_comments",
          filter: `task_id=eq.${taskId}`,
        },
        (payload: any) => {
          if (payload.eventType === "INSERT") {
            const next = payload.new as typeof comments[0];
            if (!next?.deleted_at) {
              setComments((prev) => [...prev, next]);
            }
          } else if (payload.eventType === "UPDATE") {
            const next = payload.new as typeof comments[0];
            if (next?.deleted_at) {
              setComments((prev) => prev.filter((c) => c.id !== next.id));
            } else {
              setComments((prev) => prev.map((c) => (c.id === next.id ? next : c)));
            }
          } else if (payload.eventType === "DELETE") {
            setComments((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [taskId, realtimeDisabled]);

  const addComment = useCallback(async (content: string) => {
    if (!taskId) return;

    const response = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (response.ok) {
      const { comment } = await response.json();
      // Let realtime handle the update
      return comment;
    }
  }, [taskId]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!taskId) return;

    const response = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      // Optimistically remove
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
  }, [taskId]);

  return { comments, isLoading, refetch: fetchComments, addComment, deleteComment };
}

export interface TaskLog {
  id: string;
  task_id: string;
  content: string;
  log_type?: string;
  created_at: string;
}

export function useTaskTerminalStream(
  taskId: string | null,
  options: { enabled?: boolean; tail?: number; maxChars?: number } = {}
) {
  const enabled = options.enabled ?? true;
  const tail = Number.isFinite(options.tail) && (options.tail as number) > 0 ? (options.tail as number) : 500;
  const maxChars = Number.isFinite(options.maxChars) && (options.maxChars as number) > 0 ? (options.maxChars as number) : 200_000;

  const [output, setOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backfillCooldownRef = useRef<number>(0);
  const lastSeenRef = useRef<{ created_at: string; id: string } | null>(null);

  const formatLog = useCallback((log: TaskLog) => {
    const type = (log.log_type || "output").toLowerCase();
    if (type === "output") return log.content || "";
    return `[${type}] ${log.content || ""}`;
  }, []);

  const fetchOutput = useCallback(async (appendOnly = false) => {
    if (!taskId) return;
    if (!enabled) return;
    if (!appendOnly) setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (!appendOnly) {
        params.set("tail", String(tail));
      } else {
        const lastSeen = lastSeenRef.current;
        if (lastSeen?.created_at) params.set("after", lastSeen.created_at);
        params.set("limit", "500");
      }

      const response = await fetch(`/api/tasks/${taskId}/logs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        const logs = (data.logs || []) as TaskLog[];
        const sorted = logs
          .slice()
          .sort((a, b) =>
            a.created_at === b.created_at
              ? a.id.localeCompare(b.id)
              : a.created_at.localeCompare(b.created_at)
          );
        if (!appendOnly) {
          const combined = sorted.map((log) => formatLog(log)).join("");
          setOutput(combined.length > maxChars ? combined.slice(-maxChars) : combined);
        } else {
          const lastSeen = lastSeenRef.current;
          const newLogs = lastSeen
            ? sorted.filter((log) => {
                if (log.created_at > lastSeen.created_at) return true;
                if (log.created_at < lastSeen.created_at) return false;
                return log.id > lastSeen.id;
              })
            : sorted;
          if (newLogs.length) {
            const chunk = newLogs.map((log) => formatLog(log)).join("");
            if (chunk) {
              setOutput((prev) => {
                const next = prev + chunk;
                return next.length > maxChars ? next.slice(-maxChars) : next;
              });
            }
            setIsStreaming(true);
            if (streamTimeoutRef.current) {
              clearTimeout(streamTimeoutRef.current);
            }
            streamTimeoutRef.current = setTimeout(() => {
              setIsStreaming(false);
            }, 5000);
          }
        }
        if (sorted.length) {
          const last = sorted[sorted.length - 1];
          lastSeenRef.current = { created_at: last.created_at, id: last.id };
        }
      }
    } finally {
      if (!appendOnly) setIsLoading(false);
    }
  }, [enabled, formatLog, maxChars, tail, taskId]);

  useEffect(() => {
    setOutput("");
    setIsStreaming(false);
    setIsLoading(false);
    lastSeenRef.current = null;
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    if (enabled) fetchOutput();
  }, [enabled, fetchOutput, taskId]);

  // Poll for new logs (replaces SSE stream)
  useEffect(() => {
    if (!taskId) return;
    if (!enabled) return;

    const interval = setInterval(() => fetchOutput(true), 2000);
    return () => {
      clearInterval(interval);
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }
    };
  }, [enabled, fetchOutput, taskId]);

  return { output, isLoading, isStreaming };
}

// Learning type
export interface Learning {
  id: string;
  scope: "task" | "project" | "global";
  scope_id?: string;
  content: string;
  created_at: string;
}

// Hook for learnings
export function useLearnings(scope?: string, scopeId?: string) {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLearnings = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope) params.set("scope", scope);
      if (scopeId) params.set("scopeId", scopeId);

      const response = await fetch(`/api/learnings?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setLearnings((data.learnings || []) as Learning[]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => {
    fetchLearnings();
  }, [fetchLearnings]);

  const addLearning = useCallback(async (
    content: string,
    learningScope: string,
    learningScopeId?: string
  ) => {
    const response = await fetch("/api/learnings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: learningScope,
        scopeId: learningScopeId,
        content,
      }),
    });

    if (response.ok) {
      const { learning } = await response.json();
      setLearnings((prev) => [learning, ...prev]);
      return learning;
    }
  }, []);

  const deleteLearning = useCallback(async (id: string) => {
    const response = await fetch(`/api/learnings?id=${id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      setLearnings((prev) => prev.filter((l) => l.id !== id));
    }
  }, []);

  return { learnings, isLoading, refetch: fetchLearnings, addLearning, deleteLearning };
}

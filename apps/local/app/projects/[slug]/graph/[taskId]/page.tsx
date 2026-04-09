"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import GraphFirstView from "@/components/graph/GraphFirstView";
import { useGraphUIStore } from "@/components/graph/useGraphUIStore";
import type { Task } from "@/components/TaskCard";
import { useExecutionGraph } from "@/hooks/useExecutionGraph";

interface PageParams {
  slug: string;
  taskId: string;
}

export default function FullscreenGraphPage({ params }: { params: Promise<PageParams> }) {
  const { slug, taskId } = use(params);
  const router = useRouter();

  const [task, setTask] = useState<Task | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);

  const { graph, isLoading: graphLoading, error: graphError, refetch } = useExecutionGraph(taskId);
  const resetGraphUi = useGraphUIStore((state) => state.reset);

  useEffect(() => {
    resetGraphUi();
    return () => {
      resetGraphUi();
    };
  }, [resetGraphUi]);

  const loadTask = useCallback(async () => {
    setTaskLoading(true);
    setTaskError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to fetch task (${response.status})`);
      }

      setTask((payload?.task ?? null) as Task | null);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Failed to fetch task");
      setTask(null);
    } finally {
      setTaskLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const loading = taskLoading || graphLoading;
  const error = taskError || graphError;

  const handleClose = useCallback(() => {
    router.push(`/projects/${slug}`);
  }, [router, slug]);

  const handleRefetch = useCallback(async () => {
    await Promise.all([refetch(), loadTask()]);
  }, [refetch, loadTask]);

  const handleTaskUpdate = useCallback(async (updates: Partial<Task>) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to update task");
      }
      
      await loadTask();
    } catch (err) {
      console.error("Failed to update task:", err);
      throw err;
    }
  }, [taskId, loadTask]);

  const handleDeleteTask = useCallback(async () => {
    if (isDeletingTask) {
      return;
    }

    const taskLabel = task?.slug || task?.title || taskId.slice(0, 8);
    const confirmed = window.confirm(`Delete "${taskLabel}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setIsDeletingTask(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete task");
      }
      router.push(`/projects/${slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete task";
      console.error("Failed to delete task:", err);
      window.alert(message);
    } finally {
      setIsDeletingTask(false);
    }
  }, [isDeletingTask, router, slug, task?.slug, task?.title, taskId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--background)]">
        <div className="text-center">
          <span className="spinner spinner-lg" />
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">Loading task graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--background)]">
        <div className="text-center max-w-md px-4">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--destructive-muted)] flex items-center justify-center">
            <svg className="w-6 h-6 text-[var(--destructive)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-[var(--destructive)]">{error}</p>
          <button
            onClick={() => router.push(`/projects/${slug}`)}
            className="mt-4 btn btn-secondary"
          >
            Back to Project
          </button>
        </div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--background)]">
        <div className="text-center max-w-md px-4">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--muted)] flex items-center justify-center">
            <svg className="w-6 h-6 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">No execution graph exists for this task.</p>
          <div className="mt-4 flex gap-2 justify-center">
            <button
              onClick={() => router.push(`/projects/${slug}/tasks/${taskId}`)}
              className="btn btn-secondary"
            >
              View Task Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--background)]">
        <div className="text-center max-w-md px-4">
          <p className="text-sm text-[var(--destructive)]">Task not found.</p>
          <button
            onClick={() => router.push(`/projects/${slug}`)}
            className="mt-4 btn btn-secondary"
          >
            Back to Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <GraphFirstView
      task={task}
      graph={graph}
      projectSlug={slug}
      onClose={handleClose}
      onRefetch={handleRefetch}
      onTaskUpdate={handleTaskUpdate}
      onDeleteTask={handleDeleteTask}
      isDeletingTask={isDeletingTask}
    />
  );
}

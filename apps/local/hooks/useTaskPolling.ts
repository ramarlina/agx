import { useEffect, useRef, useState, useCallback } from "react";
import type { AgxTask } from "@/types/tasks";

const TERMINAL_STATUSES = new Set(["completed", "done", "failed", "blocked"]);
const MAX_POLL_DURATION = 30 * 60 * 1000; // 30 minutes

interface UseTaskPollingOptions {
  projectId: string | null;
  enabled: boolean;
  interval?: number;
}

export function useTaskPolling({ projectId, enabled, interval = 30000 }: UseTaskPollingOptions) {
  const [tasks, setTasks] = useState<AgxTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const tasksRef = useRef<AgxTask[]>([]);

  const poll = useCallback(async () => {
    if (!projectId || projectId === "undefined") return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_AGX_BOARD_URL || "http://localhost:41741";
      const res = await fetch(`${baseUrl}/api/tasks?project=${projectId}`);
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
      const data = await res.json();
      const newTasks = data.tasks ?? data;
      tasksRef.current = newTasks;
      setTasks(newTasks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Poll failed");
    }
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId) return;

    startTimeRef.current = Date.now();
    void poll();

    const timer = setInterval(() => {
      if (Date.now() - startTimeRef.current > MAX_POLL_DURATION) {
        clearInterval(timer);
        return;
      }
      if (tasksRef.current.length > 0 && tasksRef.current.every((t) => TERMINAL_STATUSES.has(t.status))) {
        clearInterval(timer);
        return;
      }
      void poll();
    }, interval);

    return () => clearInterval(timer);
  }, [enabled, projectId, interval, poll]);

  return { tasks, error, refetch: poll };
}

import { useState, useEffect, useCallback } from 'react';
import type { GraphSchedule } from '@/src/graph/types';

export interface AutomationItem {
  taskId: string;
  graphId: string;
  title: string;
  projectId: string | null;
  schedule: GraphSchedule;
  executionState: string;
  createdAt: string;
  updatedAt: string;
}

export function useAutomations() {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/automations');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setAutomations(data.automations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
    const interval = setInterval(fetchAutomations, 10_000);
    return () => clearInterval(interval);
  }, [fetchAutomations]);

  const pauseSchedule = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}/graph/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    if (res.ok) await fetchAutomations();
    return res.ok;
  }, [fetchAutomations]);

  const resumeSchedule = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}/graph/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
    if (res.ok) await fetchAutomations();
    return res.ok;
  }, [fetchAutomations]);

  const deleteSchedule = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}/graph/schedule`, {
      method: 'DELETE',
    });
    if (res.ok) await fetchAutomations();
    return res.ok;
  }, [fetchAutomations]);

  const runNow = useCallback(async (taskId: string) => {
    const res = await fetch('/api/schedules/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
    if (res.ok) await fetchAutomations();
    return res.ok;
  }, [fetchAutomations]);

  return {
    automations,
    loading,
    error,
    refresh: fetchAutomations,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    runNow,
  };
}

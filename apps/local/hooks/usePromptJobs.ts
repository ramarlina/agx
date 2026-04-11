'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PromptJob, PromptRun } from '@/src/prompt-scheduler/types';

interface UsePromptJobsOptions {
  requireProjectId?: boolean;
  includeObjectiveJobs?: boolean;
  objectiveId?: string | null;
}

export function usePromptJobs(projectId?: string | null, options: UsePromptJobsOptions = {}) {
  const [jobs, setJobs] = useState<PromptJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialFetchDone = useRef(false);
  const requireProjectId = options.requireProjectId ?? false;
  const includeObjectiveJobs = options.includeObjectiveJobs ?? false;
  const objectiveId = options.objectiveId?.trim() || null;

  const fetchJobs = useCallback(async () => {
    if (requireProjectId && !projectId) {
      setJobs([]);
      setError(null);
      setLoading(false);
      initialFetchDone.current = true;
      return;
    }

    try {
      if (!initialFetchDone.current) setLoading(true);
      const params = new URLSearchParams();
      if (projectId) {
        params.set('projectId', projectId);
      }
      if (objectiveId) {
        params.set('objectiveId', objectiveId);
      }
      if (includeObjectiveJobs) {
        params.set('includeObjectiveJobs', 'true');
      }
      const query = params.toString();
      const res = await fetch(`/api/prompt-jobs${query ? `?${query}` : ''}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      initialFetchDone.current = true;
    }
  }, [includeObjectiveJobs, objectiveId, projectId, requireProjectId]);

  useEffect(() => {
    initialFetchDone.current = false;
    fetchJobs();
    const interval = setInterval(fetchJobs, 10_000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createJob = useCallback(async (input: any) => {
    const res = await fetch('/api/prompt-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const updateJob = useCallback(async (id: string, updates: Partial<PromptJob>) => {
    const res = await fetch(`/api/prompt-jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const deleteJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/prompt-jobs/${id}`, { method: 'DELETE' });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const toggleJob = useCallback(async (job: PromptJob) => {
    const newState = job.state === 'active' ? 'paused' : 'active';
    const res = await fetch(`/api/prompt-jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newState }),
    });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const runNow = useCallback(async (id: string) => {
    const res = await fetch('/api/prompt-jobs/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: id }),
    });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const cancelRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/prompt-jobs/${id}/cancel`, { method: 'POST' });
    if (res.ok) await fetchJobs();
    return res.ok;
  }, [fetchJobs]);

  const fetchRuns = useCallback(async (jobId: string): Promise<PromptRun[]> => {
    const res = await fetch(`/api/prompt-jobs/${jobId}/runs`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.runs ?? [];
  }, []);

  return {
    jobs, loading, error,
    refresh: fetchJobs,
    createJob, updateJob, deleteJob, toggleJob, runNow, cancelRun, fetchRuns,
  };
}

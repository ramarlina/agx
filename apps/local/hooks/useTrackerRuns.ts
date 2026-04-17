"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackerRunRecord } from "@/lib/tracker/tracker-run-store";
import type { TrackerRunMode, TrackerRunStatus } from "@/lib/tracker/types";

interface CreateTrackerRunInput {
  projectId?: string | null;
  projectSlug?: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee?: string | null;
  agentId: string;
  agentName: string;
  mode?: TrackerRunMode;
}

interface UpdateTrackerRunInput {
  rootMessageId?: string | null;
  chatRunId?: string | null;
  status?: TrackerRunStatus;
  error?: string | null;
}

/**
 * Tracker-agnostic runs hook.
 * Replaces useLinearRuns by fetching from /api/trackers/[tracker]/runs.
 */
export function useTrackerRuns(
  trackerType: string,
  issueId?: string | null,
  projectId?: string | null
) {
  const [runs, setRuns] = useState<TrackerRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedForIssueId, setLoadedForIssueId] = useState<string | null>(null);
  const issueIdRef = useRef(issueId ?? null);
  issueIdRef.current = issueId ?? null;

  const basePath = `/api/trackers/${encodeURIComponent(trackerType)}/runs`;

  const refresh = useCallback(async () => {
    const activeIssueId = issueIdRef.current?.trim();
    if (!activeIssueId) {
      setRuns([]);
      setLoadedForIssueId(null);
      return [];
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ issueId: activeIssueId });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`${basePath}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tracker runs: ${response.status}`);
      }
      const data = await response.json();
      const nextRuns = Array.isArray(data.runs) ? (data.runs as TrackerRunRecord[]) : [];
      setRuns(nextRuns);
      setLoadedForIssueId(activeIssueId);
      return nextRuns;
    } finally {
      setLoading(false);
    }
  }, [projectId, basePath]);

  useEffect(() => {
    setRuns([]);
    setLoadedForIssueId(null);
    void refresh();
  }, [refresh, issueId]);

  useEffect(() => {
    if (!issueId) return;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [issueId, refresh]);

  const createRun = useCallback(async (input: CreateTrackerRunInput) => {
    const response = await fetch(basePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Failed to create tracker run: ${response.status}`);
    }
    const data = await response.json();
    const run = data.run as TrackerRunRecord;
    const recapContent: string | null = data.recapContent ?? null;
    setRuns((previous) => [run, ...previous.filter((entry) => entry.id !== run.id)]);
    return { run, recapContent };
  }, [basePath]);

  const updateRun = useCallback(async (id: string, input: UpdateTrackerRunInput) => {
    const response = await fetch(`${basePath}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Failed to update tracker run: ${response.status}`);
    }
    const data = await response.json();
    const run = data.run as TrackerRunRecord;
    setRuns((previous) =>
      previous.map((entry) => (entry.id === run.id ? run : entry))
    );
    return run;
  }, [basePath]);

  return {
    runs,
    loading,
    loadedForIssueId,
    refresh,
    createRun,
    updateRun,
  };
}
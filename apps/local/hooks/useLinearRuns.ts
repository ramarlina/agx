"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LinearRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type LinearRunMode = "chat" | "scripted";

export interface LinearRun {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee: string | null;
  threadId: string;
  rootMessageId: string | null;
  chatRunId: string | null;
  agentId: string;
  agentName: string;
  mode: LinearRunMode;
  sessionTitle: string | null;
  status: LinearRunStatus;
  durationMs: number | null;
  lastError: string | null;
  recapFilePath: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface CreateLinearRunInput {
  projectId?: string | null;
  projectSlug?: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStatus: string;
  issueAssignee?: string | null;
  agentId: string;
  agentName: string;
  mode?: LinearRunMode;
}

interface UpdateLinearRunInput {
  rootMessageId?: string | null;
  chatRunId?: string | null;
  status?: LinearRunStatus;
  error?: string | null;
}

export function useLinearRuns(issueId?: string | null, projectId?: string | null) {
  const [runs, setRuns] = useState<LinearRun[]>([]);
  const [loading, setLoading] = useState(false);
  const issueIdRef = useRef(issueId ?? null);
  issueIdRef.current = issueId ?? null;

  const refresh = useCallback(async () => {
    const activeIssueId = issueIdRef.current?.trim();
    if (!activeIssueId) {
      setRuns([]);
      return [];
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ issueId: activeIssueId });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/linear/runs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch Linear runs: ${response.status}`);
      }
      const data = await response.json();
      const nextRuns = Array.isArray(data.runs) ? (data.runs as LinearRun[]) : [];
      setRuns(nextRuns);
      return nextRuns;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setRuns([]);
    void refresh();
  }, [refresh, issueId]);

  useEffect(() => {
    if (!issueId) return;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [issueId, refresh]);

  const createRun = useCallback(async (input: CreateLinearRunInput) => {
    const response = await fetch("/api/linear/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Failed to create Linear run: ${response.status}`);
    }
    const data = await response.json();
    const run = data.run as LinearRun;
    setRuns((previous) => [run, ...previous.filter((entry) => entry.id !== run.id)]);
    return run;
  }, []);

  const updateRun = useCallback(async (id: string, input: UpdateLinearRunInput) => {
    const response = await fetch(`/api/linear/runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Failed to update Linear run: ${response.status}`);
    }
    const data = await response.json();
    const run = data.run as LinearRun;
    setRuns((previous) =>
      previous.map((entry) => (entry.id === run.id ? run : entry))
    );
    return run;
  }, []);

  return {
    runs,
    loading,
    refresh,
    createRun,
    updateRun,
  };
}

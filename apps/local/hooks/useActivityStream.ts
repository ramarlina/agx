"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { AgentProcessEntry } from "@/lib/agent-process-registry";
import type { Participant } from "@/lib/types";
import { usePromptJobs } from "./usePromptJobs";
import { useAutomations } from "./useAutomations";

export type ActivityStatus = "running" | "completed" | "failed" | "queued";
export type ActivitySource = "Chat" | "Scheduled Task" | "Automation" | "Daemon";

export interface ActivityItem {
  id: string;
  agentId: string | null;
  agentName: string;
  agentColor: string;
  type: "chat-run" | "prompt-job" | "automation" | "process";
  title: string;
  source: ActivitySource;
  status: ActivityStatus;
  startedAt: number;
  durationMs: number | null;
}

const ACTIVE_STATES = new Set(["spawning", "running"]);
const ONE_HOUR = 60 * 60 * 1000;

function resolveAgent(
  agentId: string | null,
  participants: Participant[]
): { name: string; color: string } {
  if (!agentId) return { name: "Unknown", color: "#6B7280" };
  const p = participants.find((p) => p.id === agentId);
  return p
    ? { name: p.name, color: p.color }
    : { name: agentId.slice(0, 8), color: "#6B7280" };
}

function processStatus(state: string): ActivityStatus {
  if (ACTIVE_STATES.has(state)) return "running";
  if (state === "done") return "completed";
  if (state === "error" || state === "killed") return "failed";
  return "completed";
}

export function useActivityStream(
  projectId: string | null,
  participants: Participant[]
) {
  const [processes, setProcesses] = useState<AgentProcessEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/processes");
      if (!res.ok) return;
      const data: AgentProcessEntry[] = await res.json();
      setProcesses(data);
    } catch {
      // silent — non-critical UI feature
    }
  }, []);

  useEffect(() => {
    fetchProcesses();
    intervalRef.current = setInterval(fetchProcesses, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchProcesses]);

  const { jobs } = usePromptJobs(projectId);
  const { automations } = useAutomations();

  const items = useMemo<ActivityItem[]>(() => {
    const now = Date.now();
    const cutoff = now - ONE_HOUR;
    const result: ActivityItem[] = [];

    // Processes → Chat / Daemon activity
    for (const proc of processes) {
      if (projectId && proc.projectSlug !== projectId) continue;
      const status = processStatus(proc.state);
      if (status !== "running" && proc.startedAt < cutoff) continue;
      const { name, color } = resolveAgent(proc.agentId, participants);
      result.push({
        id: `proc-${proc.id}`,
        agentId: proc.agentId,
        agentName: name,
        agentColor: color,
        type: proc.threadId ? "chat-run" : "process",
        title: proc.threadId ? "Chat response" : "Agent process",
        source: proc.threadId ? "Chat" : "Daemon",
        status,
        startedAt: proc.startedAt,
        durationMs: proc.lastActivity - proc.startedAt,
      });
    }

    // Prompt jobs → Scheduled Task activity
    for (const job of jobs) {
      if (projectId && job.projectId !== projectId) continue;
      const isActive =
        job.lastOutcome === "running" || job.lastOutcome === "queued";
      const lastRun = job.lastRunAt ?? 0;
      if (!isActive && lastRun < cutoff) continue;

      const status: ActivityStatus = isActive
        ? job.lastOutcome === "queued"
          ? "queued"
          : "running"
        : job.lastOutcome === "success"
          ? "completed"
          : job.lastOutcome === "failed"
            ? "failed"
            : "completed";
      const { name, color } = resolveAgent(job.agentId, participants);
      result.push({
        id: `job-${job.id}`,
        agentId: job.agentId,
        agentName: name,
        agentColor: color,
        type: "prompt-job",
        title: job.name,
        source: "Scheduled Task",
        status,
        startedAt: lastRun,
        durationMs: null,
      });
    }

    // Automations
    for (const auto of automations) {
      if (projectId && auto.projectId !== projectId) continue;
      const isRunning = auto.executionState === "running";
      const updated = new Date(auto.updatedAt).getTime();
      if (!isRunning && updated < cutoff) continue;

      result.push({
        id: `auto-${auto.taskId}`,
        agentId: null,
        agentName: auto.title,
        agentColor: "#7C3AED",
        type: "automation",
        title: auto.title,
        source: "Automation",
        status: isRunning ? "running" : "completed",
        startedAt: updated,
        durationMs: null,
      });
    }

    // Sort: running/queued first, then by startedAt descending
    result.sort((a, b) => {
      const aActive = a.status === "running" || a.status === "queued" ? 1 : 0;
      const bActive = b.status === "running" || b.status === "queued" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.startedAt - a.startedAt;
    });

    return result;
  }, [processes, jobs, automations, participants, projectId]);

  const activeCount = useMemo(
    () => items.filter((i) => i.status === "running" || i.status === "queued").length,
    [items]
  );

  return { items, activeCount };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Pause, Play, RefreshCw } from "lucide-react";
import { ScheduleConditionPicker } from "@/components/scheduling/ScheduleConditionPicker";
import type { PromptJob } from "@/src/prompt-scheduler/types";

interface AgentOption {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  color: string;
}

interface LinearWorkerConfigProps {
  projectId?: string;
}

function formatNextRun(
  epochMs: number | null,
  state: PromptJob["state"]
): string {
  if (state === "paused") return "Paused";
  if (state === "stopped") return "Stopped";
  if (epochMs === null) return "Pending";
  const diff = epochMs - Date.now();
  if (diff < 0) return "Overdue";
  if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

function formatLastRun(epochMs: number | null): string {
  if (!epochMs) return "Never";
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export default function LinearWorkerConfig({
  projectId,
}: LinearWorkerConfigProps) {
  const [job, setJob] = useState<PromptJob | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState("*/30 * * * *");
  const [agentId, setAgentId] = useState("");
  const [provider, setProvider] = useState("claude");
  const [model, setModel] = useState("");

  const initialFetch = useRef(false);

  const fetchWorker = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/api/linear/worker?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        setPrompt(data.job.prompt || "");
        setCadence(data.job.cronExpr || data.job.cadence || "*/30 * * * *");
        setAgentId(data.job.agentId || "");
        setProvider(data.job.provider || "claude");
        setModel(data.job.model || "");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/prompt-jobs/agents");
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!initialFetch.current) {
      initialFetch.current = true;
      fetchWorker();
      fetchAgents();
    }
  }, [fetchWorker, fetchAgents]);

  // Poll for status updates
  useEffect(() => {
    const interval = setInterval(fetchWorker, 15_000);
    return () => clearInterval(interval);
  }, [fetchWorker]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        prompt,
        cadence,
        agentId,
        provider,
        model,
      };
      if (projectId) body.projectId = projectId;

      const res = await fetch("/api/linear/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [prompt, cadence, agentId, provider, model, projectId]);

  const handleToggle = useCallback(async () => {
    if (!job) {
      // Create and enable
      await handleSave();
      return;
    }

    setSaving(true);
    try {
      const nextState = job.state === "active" ? "paused" : "active";
      const res = await fetch("/api/linear/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          state: nextState,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [job, projectId, handleSave]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <RefreshCw size={14} className="animate-spin" />
          Loading Linear Worker...
        </div>
      </div>
    );
  }

  const isActive = job?.state === "active";

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--card-border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Bot size={16} className="text-[var(--muted-foreground)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">
            Linear Worker
          </span>
          {job && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                isActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              }`}
            >
              {job.state}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={handleToggle}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            isActive
              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
          }`}
        >
          {isActive ? (
            <>
              <Pause size={12} /> Pause
            </>
          ) : (
            <>
              <Play size={12} /> {job ? "Resume" : "Enable"}
            </>
          )}
        </button>
      </div>

      {/* Status bar */}
      {job && (
        <div className="flex items-center gap-4 border-b border-[var(--card-border)] px-4 py-2 text-xs text-[var(--muted-foreground)]">
          <span>
            Next run:{" "}
            <span className="text-[var(--foreground)]">
              {formatNextRun(job.nextRunAt, job.state)}
            </span>
          </span>
          <span>
            Last run:{" "}
            <span className="text-[var(--foreground)]">
              {formatLastRun(job.lastRunAt)}
            </span>
          </span>
          {job.lastOutcome && (
            <span>
              Last outcome:{" "}
              <span
                className={
                  job.lastOutcome === "success"
                    ? "text-emerald-400"
                    : job.lastOutcome === "failed"
                      ? "text-red-400"
                      : "text-[var(--foreground)]"
                }
              >
                {job.lastOutcome}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Configuration */}
      <div className="space-y-4 p-4">
        <p className="text-xs text-[var(--muted-foreground)]">
          The Linear Worker autonomously observes your full Linear workspace and
          decides what to work on next, guided by the prompt below.
        </p>

        {/* Guiding prompt */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
            Guiding prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g., Focus on high-priority bugs first. Then work on the current sprint tickets."
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
          />
        </div>

        {/* Schedule */}
        <ScheduleConditionPicker
          value={{ cadence, condition: "" }}
          onChange={(next) => setCadence(next.cadence)}
          scheduleLabel="Schedule"
        />

        {/* Agent selector */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
            Agent
          </label>
          <select
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              const selectedAgent = agents.find(
                (a) => a.id === e.target.value
              );
              if (selectedAgent) {
                setProvider(selectedAgent.provider);
                setModel(selectedAgent.model || "");
              }
            }}
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
          >
            <option value="">Default (claude)</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.provider}
                {agent.model ? ` / ${agent.model}` : ""})
              </option>
            ))}
          </select>
        </div>

        {/* Save button */}
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="w-full rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-4 py-2 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save configuration"}
        </button>
      </div>
    </div>
  );
}

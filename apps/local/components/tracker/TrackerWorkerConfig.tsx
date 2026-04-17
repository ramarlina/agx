"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronRight, Play, RefreshCw } from "lucide-react";
import { ScheduleConditionPicker, SimpleDropdown } from "@/components/scheduling/ScheduleConditionPicker";
import {
  TASK_WORKER_DEFAULT_PROMPT,
  TASK_WORKER_DEFAULT_SCRIPT_PROMPT,
} from "@/src/prompt-scheduler/task-worker-constants";
import type { PromptJob } from "@/src/prompt-scheduler/types";

const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), {
  ssr: false,
});

interface TeamOption {
  id: string;
  name: string;
}

interface TrackerWorkerConfigProps {
  projectId?: string;
  onJobLoaded?: (jobId: string | null) => void;
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
      {children}
    </label>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-widest hover:text-[var(--foreground)] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {expanded && (
        <div className="border-t border-[var(--card-border)]">
          {children}
        </div>
      )}
    </div>
  );
}

export default function TrackerWorkerConfig({
  projectId,
  onJobLoaded,
}: TrackerWorkerConfigProps) {
  const [job, setJob] = useState<PromptJob | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [prompt, setPrompt] = useState(TASK_WORKER_DEFAULT_PROMPT);
  const [scriptPrompt, setScriptPrompt] = useState(TASK_WORKER_DEFAULT_SCRIPT_PROMPT);
  const [cadence, setCadence] = useState("*/30 * * * *");
  const [condition, setCondition] = useState("");
  const [teamId, setTeamId] = useState("");

  // Collapsible sections
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [executionExpanded, setExecutionExpanded] = useState(true);

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
        setPrompt(data.job.prompt || TASK_WORKER_DEFAULT_PROMPT);
        setScriptPrompt(data.job.scriptPrompt || TASK_WORKER_DEFAULT_SCRIPT_PROMPT);
        setCadence(data.job.cronExpr || data.job.cadence || "*/30 * * * *");
        setCondition(data.job.condition || "");
        setTeamId(data.job.teamId || "");
        onJobLoaded?.(data.job.id);
      } else {
        onJobLoaded?.(null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, onJobLoaded]);

  const fetchTeams = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/teams`);
      if (!res.ok) return;
      const data = await res.json();
      const fetchedTeams: TeamOption[] = (data.teams ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
      }));
      setTeams(fetchedTeams);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    if (!initialFetch.current) {
      initialFetch.current = true;
      fetchWorker();
      fetchTeams();
    }
  }, [fetchWorker, fetchTeams]);

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
        scriptPrompt,
        cadence,
        condition,
        teamId,
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
  }, [prompt, scriptPrompt, cadence, condition, teamId, projectId]);

  const handleToggle = useCallback(async () => {
    if (!job) {
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

  const [runningNow, setRunningNow] = useState(false);

  const handleRunNow = useCallback(async () => {
    if (!job) return;
    setRunningNow(true);
    try {
      await fetch("/api/prompt-jobs/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      // Refresh status after triggering
      setTimeout(fetchWorker, 1000);
    } catch {
      // ignore
    } finally {
      setRunningNow(false);
    }
  }, [job, fetchWorker]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-[var(--muted-foreground)]">
        <RefreshCw size={14} className="animate-spin" />
        Loading Worker...
      </div>
    );
  }

  const isActive = job?.state === "active";

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
          {job && (
            <>
              <span>
                Next: <span className="text-[var(--foreground)]">{formatNextRun(job.nextRunAt, job.state)}</span>
              </span>
              <span>
                Last: <span className="text-[var(--foreground)]">{formatLastRun(job.lastRunAt)}</span>
              </span>
              {job.lastOutcome && (
                <span>
                  Outcome:{" "}
                  <span className={job.lastOutcome === "success" ? "text-emerald-400" : job.lastOutcome === "failed" ? "text-red-400" : "text-[var(--foreground)]"}>
                    {job.lastOutcome}
                  </span>
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Run Now button */}
          {job && (
            <button
              type="button"
              disabled={runningNow || saving}
              onClick={handleRunNow}
              className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-40"
            >
              {runningNow ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Run now
            </button>
          )}
          {/* Enable / Disable toggle */}
          <button
            type="button"
            disabled={saving}
            onClick={handleToggle}
            className="relative flex items-center gap-2.5 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--muted-foreground)]"
          >
            {/* Toggle track */}
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                isActive ? "bg-emerald-500" : "bg-[var(--card-border)]"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  isActive ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
            {isActive ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      {/* Main layout: Left (prompts) | Right (config) */}
      <div className="flex flex-1 min-h-0 gap-6 overflow-y-auto">
        {/* Left: Collapsible prompt sections */}
        <div className="flex flex-1 min-w-0 flex-col gap-4">
          {/* Ticket Selection — collapsible */}
          <CollapsibleSection
            title="How to pick a ticket"
            expanded={selectionExpanded}
            onToggle={() => setSelectionExpanded(!selectionExpanded)}
          >
            <div className="min-h-[120px] overflow-y-auto resize-y" style={{ height: 320 }}>
              <RichTextEditor
                content={prompt}
                onChange={(md) => setPrompt(md)}
                placeholder="Describe how to pick which ticket to work on..."
              />
            </div>
          </CollapsibleSection>

          {/* Execution Prompt — collapsible */}
          <CollapsibleSection
            title="How to work a ticket"
            expanded={executionExpanded}
            onToggle={() => setExecutionExpanded(!executionExpanded)}
          >
            <div className="min-h-[300px] max-h-[50vh] overflow-y-auto">
              <RichTextEditor
                content={scriptPrompt}
                onChange={(md) => setScriptPrompt(md)}
                placeholder="Instructions injected into the agent session when working a ticket..."
              />
            </div>
          </CollapsibleSection>
        </div>

        {/* Right: Team + Agent + Schedule */}
        <div className="w-[340px] shrink-0 space-y-6">
          {/* Team selector */}
          {teams.length > 0 && (
            <div>
              <Label>Team</Label>
              <SimpleDropdown
                value={teamId || ""}
                options={[
                  { value: "", label: "Select a team" },
                  ...teams.map((t) => ({ value: t.id, label: t.name })),
                ]}
                onChange={(v) => setTeamId(v)}
                ariaLabel="Select team"
              />
              <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
                Agents in this team become default participants of the tracker chat.
              </p>
            </div>
          )}

          {/* Schedule */}
          <ScheduleConditionPicker
            value={{ cadence, condition }}
            onChange={(next) => {
              setCadence(next.cadence);
              setCondition(next.condition);
            }}
            scheduleLabel="Schedule"
            conditionLabel="Condition"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="flex shrink-0 justify-end pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-lg bg-[var(--foreground)] px-5 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save configuration"}
        </button>
      </div>
    </div>
  );
}

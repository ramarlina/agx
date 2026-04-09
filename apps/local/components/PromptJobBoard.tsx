"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { UI_POLL_PROMPT_RUNS_MS } from "@/lib/constants/timing";
import dynamic from "next/dynamic";
import {
  Play,
  Pause,
  Trash2,
  Plus,
  X,
  Clock,
  Terminal,
  RefreshCw,
  ChevronDown,
  Settings2,
  Zap,
  Calendar,
  CalendarDays,
  Repeat,
  Pencil,
  ArrowLeft,
  Copy,
  ExternalLink,
  User,
  Sparkles,
} from "lucide-react";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { Markdown } from "@/components/chat-ui/Markdown";
import { stripMarkers } from "@/lib/chat-utils";
import {
  orderParticipantIds,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import type { GroupMessage } from "@/lib/types";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";
import { cronToHuman } from "@/src/graph/nl-schedule";

const Composer = dynamic(() => import("@/components/chat-ui/Composer").then((m) => m.Composer), {
  ssr: false,
});

const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), {
  ssr: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNextRun(epochMs: number | null, state: string): string {
  if (state === "paused") return "Paused";
  if (state === "stopped") return "Stopped";
  if (epochMs === null) return "Pending...";
  const diff = epochMs - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function StateBadge({ state }: { state: PromptJob["state"] }) {
  const styles: Record<string, string> = {
    active: "text-green-400 bg-green-400/10 border-green-400/20",
    paused: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    stopped:
      "text-[var(--muted-foreground)] bg-[var(--muted)] border-[var(--card-border)]",
  };
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${styles[state] ?? styles.stopped}`}
    >
      {state}
    </span>
  );
}

const statusDotColor: Record<string, string> = {
  active: "bg-emerald-400",
  paused: "bg-amber-400",
  stopped: "bg-zinc-500",
};

const runStatusDot: Record<string, string> = {
  success: "bg-emerald-400",
  failed: "bg-red-400",
  cancelled: "bg-zinc-500",
  running: "bg-sky-400",
  queued: "bg-amber-400",
};

// ── Create/Edit Modal ────────────────────────────────────────────────────────

interface AgentOption {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  color: string;
  title: string | null;
}

interface CreateJobData {
  name: string;
  prompt: string;
  agentId: string;
  provider: string;
  model: string;
  cliArgs: string;
  catchUpPolicy: string;
  cadence: string;
  triggerType: string;
  condition: string;
  checkEveryMs: number;
}

const DAYS_OF_WEEK = [
  { label: "Sun", short: "S", value: 0 },
  { label: "Mon", short: "M", value: 1 },
  { label: "Tue", short: "T", value: 2 },
  { label: "Wed", short: "W", value: 3 },
  { label: "Thu", short: "T", value: 4 },
  { label: "Fri", short: "F", value: 5 },
  { label: "Sat", short: "S", value: 6 },
];

function getOrdinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function buildCron(
  freq: string,
  hour: string,
  minute: string,
  days: number[],
  monthDay: number,
): string {
  switch (freq) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${days.sort().join(",")}`;
    case "monthly":
      return `${minute} ${hour} ${monthDay} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

function buildHumanReadable(
  freq: string,
  hour: string,
  minute: string,
  days: number[],
  monthDay: number,
): string {
  const hh = parseInt(hour);
  const suffix = hh >= 12 ? "PM" : "AM";
  const displayHour = hh % 12 || 12;
  const time = `${displayHour}:${minute} ${suffix}`;

  switch (freq) {
    case "hourly":
      return `Every hour at :${minute}`;
    case "daily":
      return `Every day at ${time}`;
    case "weekly": {
      const labels = days
        .sort()
        .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)!.label);
      return `${time} on ${labels.join(", ")}`;
    }
    case "monthly":
      return `${monthDay}${getOrdinal(monthDay)} of every month at ${time}`;
    default:
      return `Every day at ${time}`;
  }
}

function ScheduleBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (cron: string, label: string) => void;
}) {
  const [freq, setFreq] = useState("daily");
  const [hour, setHour] = useState("09");
  const [minute, setMinute] = useState("00");
  const [selectedDays, setSelectedDays] = useState([1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState(1);

  useEffect(() => {
    const cron = buildCron(freq, hour, minute, selectedDays, monthDay);
    const label = buildHumanReadable(
      freq,
      hour,
      minute,
      selectedDays,
      monthDay,
    );
    onChange(cron, label);
  }, [freq, hour, minute, selectedDays, monthDay]);

  const toggleDay = (d: number) =>
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );

  const freqPill = (
    id: string,
    label: string,
    Icon: React.ComponentType<{ size?: number }>,
  ) => (
    <button
      key={id}
      type="button"
      onClick={() => setFreq(id)}
      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all text-[11px] font-medium ${
        freq === id
          ? "border-[var(--foreground)] bg-[var(--foreground)]/5 text-[var(--foreground)]"
          : "border-[var(--card-border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:border-[var(--muted-foreground)]"
      }`}
    >
      <Icon size={16} />
      <span className="mt-1">{label}</span>
    </button>
  );

  const selectClass =
    "bg-[var(--muted)] border border-[var(--card-border)] rounded-lg px-2 py-1.5 text-sm font-medium text-[var(--foreground)] focus:outline-none focus:border-[var(--foreground)] transition-colors";

  return (
    <div className="space-y-4">
      {/* Frequency pills */}
      <div className="grid grid-cols-4 gap-2">
        {freqPill("hourly", "Hourly", Repeat)}
        {freqPill("daily", "Daily", Clock)}
        {freqPill("weekly", "Weekly", CalendarDays)}
        {freqPill("monthly", "Monthly", Calendar)}
      </div>

      {/* Time picker (not for hourly) */}
      {freq !== "hourly" ? (
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1.5">
            Time
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              className={selectClass}
            >
              {Array.from({ length: 24 }).map((_, i) => {
                const val = i.toString().padStart(2, "0");
                return (
                  <option key={val} value={val}>
                    {val}
                  </option>
                );
              })}
            </select>
            <span className="text-sm font-bold text-[var(--muted-foreground)]">
              :
            </span>
            <select
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
              className={selectClass}
            >
              {[
                "00",
                "05",
                "10",
                "15",
                "20",
                "25",
                "30",
                "35",
                "40",
                "45",
                "50",
                "55",
              ].map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
            <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)]">
              {parseInt(hour) >= 12 ? "PM" : "AM"}
            </span>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1.5">
            At minute
          </div>
          <select
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            className={selectClass}
          >
            {[
              "00",
              "05",
              "10",
              "15",
              "20",
              "25",
              "30",
              "35",
              "40",
              "45",
              "50",
              "55",
            ].map((val) => (
              <option key={val} value={val}>
                :{val}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly: day selector */}
      {freq === "weekly" && (
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1.5">
            Repeat on
          </div>
          <div className="flex gap-1.5">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={`size-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                  selectedDays.includes(day.value)
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--card-border)]"
                }`}
              >
                {day.label[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly: date grid */}
      {freq === "monthly" && (
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1.5">
            On day
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 31 }).map((_, i) => {
              const d = i + 1;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMonthDay(d)}
                  className={`size-7 rounded-lg flex items-center justify-center text-[10px] font-medium transition-all ${
                    monthDay === d
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--card-border)]"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="px-3 py-2 rounded-lg bg-[var(--muted)] border border-[var(--card-border)]">
        <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">
          Schedule
        </div>
        <div className="text-xs font-medium text-[var(--foreground)]">
          {buildHumanReadable(freq, hour, minute, selectedDays, monthDay)}
        </div>
        <div className="text-[10px] font-mono text-[var(--muted-foreground)] mt-0.5">
          {buildCron(freq, hour, minute, selectedDays, monthDay)}
        </div>
      </div>
    </div>
  );
}

const CHECK_PRESETS = [
  { label: "1 min", ms: 60000 },
  { label: "5 min", ms: 300000 },
  { label: "15 min", ms: 900000 },
  { label: "30 min", ms: 1800000 },
  { label: "1 hour", ms: 3600000 },
] as const;

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
      {children}
    </label>
  );
}

function agentAvatar(id: string, color: string, size = 24) {
  const bg = color ? color.replace("#", "") : "e2e8f0";
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(id)}&size=${size}&backgroundColor=${bg}`;
}

function AgentDropdown({
  agents,
  value,
  onChange,
}: {
  agents: AgentOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = agents.find((a) => a.id === value);

  return (
    <div className="relative">
      <Label>Agent</Label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] text-left transition-colors hover:border-[var(--muted-foreground)]"
      >
        {selected ? (
          <>
            <img
              src={agentAvatar(selected.id, selected.color)}
              alt=""
              className="size-6 rounded-full shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[var(--foreground)] truncate">
                {selected.name}
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {selected.provider}
                {selected.model ? ` / ${selected.model}` : ""}
              </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">
            Select an agent...
          </span>
        )}
        <ChevronDown
          size={14}
          className={`ml-auto text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg max-h-[280px] overflow-y-auto">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onChange(a.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted)] ${value === a.id ? "bg-[var(--muted)]" : ""}`}
            >
              <img
                src={agentAvatar(a.id, a.color)}
                alt=""
                className="size-6 rounded-full shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[var(--foreground)] truncate">
                  {a.name}
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)]">
                  {a.provider}
                  {a.model ? ` / ${a.model}` : ""}
                </div>
              </div>
              {value === a.id && (
                <span className="text-xs text-[var(--foreground)]">
                  &#10003;
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateJobModal({
  onClose,
  onSubmit,
  editingJob,
}: {
  onClose: () => void;
  onSubmit: (data: CreateJobData) => Promise<void>;
  editingJob?: PromptJob | null;
}) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [name, setName] = useState(editingJob?.name ?? "");
  const [prompt, setPrompt] = useState(editingJob?.prompt ?? "");
  const [agentId, setAgentId] = useState(editingJob?.agentId ?? "");
  const [provider, setProvider] = useState(editingJob?.provider ?? "claude");
  const [model, setModel] = useState(editingJob?.model ?? "");

  useEffect(() => {
    fetch("/api/prompt-jobs/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch((err) => console.warn('[PromptJobBoard] fetch agents failed:', err));
  }, []);
  const [cliArgs, setCliArgs] = useState(editingJob?.cliArgs ?? "");
  const [cadence, setCadence] = useState(editingJob?.cadence ?? "");
  const [cadenceLabel, setCadenceLabel] = useState(editingJob?.cadence ?? "");
  const [triggerType, setTriggerType] = useState<"scheduled" | "condition">(
    (editingJob?.triggerType as any) ?? "scheduled",
  );
  const [condition, setCondition] = useState(editingJob?.condition ?? "");
  const [checkEveryMs, setCheckEveryMs] = useState(
    editingJob?.checkEveryMs ?? 300000,
  );
  const [catchUpPolicy, setCatchUpPolicy] = useState<'fire_once' | 'replay_all' | 'skip'>(editingJob?.catchUpPolicy ?? 'fire_once');
  const [showAdvanced, setShowAdvanced] = useState(!!editingJob?.cliArgs || (editingJob?.catchUpPolicy != null && editingJob.catchUpPolicy !== 'fire_once'));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    if (triggerType === "scheduled" && !cadence.trim()) return;
    if (triggerType === "condition" && !condition.trim()) return;
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      agentId,
      provider,
      model: model.trim(),
      cliArgs: cliArgs.trim(),
      catchUpPolicy,
      cadence: triggerType === "scheduled" ? cadence.trim() : "",
      triggerType,
      condition: condition.trim(),
      checkEveryMs,
    });
    setSubmitting(false);
    onClose();
  };

  const inputClass =
    "w-full bg-[var(--muted)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--foreground)] transition-colors";
  const pillClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
      active
        ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
        : "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--card-border)] hover:border-[var(--muted-foreground)] hover:text-[var(--foreground)]"
    }`;

  return (
    <div className="h-full flex flex-col text-[var(--foreground)]">
      <div className="h-14 shrink-0 border-b border-[var(--card-border)] flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <X size={18} />
          </button>
          <h2 className="text-sm font-semibold">
            {editingJob ? "Edit Prompt Job" : "New Prompt Job"}
          </h2>
        </div>
        <button
          onClick={handleSubmit as any}
          disabled={submitting || !name.trim() || !prompt.trim()}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {submitting
            ? "Saving..."
            : editingJob
              ? "Save Changes"
              : "Create Job"}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 border-r border-[var(--card-border)] flex flex-col min-w-0">
          <div className="px-8 pt-8 pb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled job"
              className="w-full text-2xl font-bold bg-transparent border-none outline-none placeholder:text-[var(--muted-foreground)]/40 text-[var(--foreground)]"
              autoFocus
            />
          </div>
          <div className="flex-1 px-8 pb-8 overflow-y-auto">
            <Label>Instructions</Label>
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden min-h-[300px]">
              <RichTextEditor
                content={prompt}
                onChange={(md) => setPrompt(md)}
                placeholder="Describe what this prompt should do..."
              />
            </div>
          </div>
        </div>

        <div className="w-[380px] shrink-0 overflow-y-auto p-6 space-y-6">
          {/* Agent picker dropdown */}
          <AgentDropdown
            agents={agents}
            value={agentId}
            onChange={(id) => {
              setAgentId(id);
              const a = agents.find((a) => a.id === id);
              if (a) {
                setProvider(a.provider);
                setModel(a.model ?? "");
              } else {
                setProvider("claude");
                setModel("");
              }
            }}
          />

          <div>
            <Label>Trigger</Label>
            <div className="flex rounded-lg border border-[var(--card-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setTriggerType("scheduled")}
                className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${triggerType === "scheduled" ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                <Calendar size={13} /> Schedule
              </button>
              <button
                type="button"
                onClick={() => setTriggerType("condition")}
                className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${triggerType === "condition" ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                <Zap size={13} /> Condition
              </button>
            </div>
          </div>

          {triggerType === "scheduled" ? (
            <ScheduleBuilder
              value={cadence}
              onChange={(cron, label) => {
                setCadence(cron);
                setCadenceLabel(label);
              }}
            />
          ) : (
            <>
              <div>
                <Label>Condition</Label>
                <textarea
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="there are unread emails in my inbox"
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
                <p className="text-[10px] text-[var(--muted-foreground)] mt-1.5">
                  The LLM evaluates this as a gate. If true, the prompt runs.
                </p>
              </div>
              <div>
                <Label>Check frequency</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CHECK_PRESETS.map((preset) => (
                    <button
                      key={preset.ms}
                      type="button"
                      onClick={() => setCheckEveryMs(preset.ms)}
                      className={pillClass(checkEveryMs === preset.ms)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <Settings2 size={12} /> {showAdvanced ? "Hide" : "Show"} advanced
              <ChevronDown
                size={12}
                className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 pt-3 border-t border-[var(--card-border)]">
                <div>
                  <Label>CLI Arguments</Label>
                  <input
                    type="text"
                    value={cliArgs}
                    onChange={(e) => setCliArgs(e.target.value)}
                    placeholder="--dangerously-skip-permissions"
                    className={inputClass}
                  />
                  <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                    Extra flags passed to the CLI command.
                  </p>
                </div>
                <div>
                  <Label>When missed</Label>
                  <div className="space-y-1.5">
                    {([
                      { id: 'fire_once', label: 'Run once on recovery', desc: 'Execute a single run regardless of how many were missed' },
                      { id: 'replay_all', label: 'Run all missed', desc: 'Queue one run per missed occurrence (use with caution)' },
                      { id: 'skip', label: 'Skip and wait for next', desc: 'Discard missed runs, wait for the next scheduled time' },
                    ] as const).map((opt) => (
                      <button key={opt.id} type="button" onClick={() => setCatchUpPolicy(opt.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                          catchUpPolicy === opt.id
                            ? 'border-[var(--foreground)] bg-[var(--foreground)]/5'
                            : 'border-[var(--card-border)] bg-[var(--muted)] hover:border-[var(--muted-foreground)]'
                        }`}>
                        <div className="text-xs font-medium text-[var(--foreground)]">{opt.label}</div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Run Chat Panel ──────────────────────────────────────────────────────────

function RunChatPanel({
  run,
  job,
  agentMap,
}: {
  run: PromptRun;
  job: PromptJob;
  agentMap: Record<string, AgentOption>;
}) {
  const threadId = `prompt-run:${run.id}`;
  const agentName =
    job.agentId && agentMap[job.agentId] ? agentMap[job.agentId].name : null;
  const agent = job.agentId ? agentMap[job.agentId] : null;

  // Fetch project-scoped agent IDs
  const [projectAgentIds, setProjectAgentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!job.projectId) return;
    fetch(`/api/projects/${encodeURIComponent(job.projectId)}/agents`)
      .then((r) => r.json())
      .then((d) => {
        const ids = new Set<string>(
          (d.agents ?? []).map((a: { agent_id: string }) => a.agent_id),
        );
        setProjectAgentIds(ids);
      })
      .catch((err) => console.warn('[PromptJobBoard] fetch project agents failed:', err));
  }, [job.projectId]);

  // Build Participant[] from only the project's agents
  const participants = useMemo(
    () =>
      Object.values(agentMap)
        .filter((a) => projectAgentIds.has(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title ?? undefined,
          provider: (a.provider ?? "claude") as import("@/lib/types").ChatProvider,
          model: a.model,
          color: a.color,
        })),
    [agentMap, projectAgentIds],
  );

  // Stable root message ID so all messages form a single thread with full history
  const rootMessageId = useMemo(() => `run-root:${run.id}`, [run.id]);

  const {
    messages,
    setMessages,
    sendMessage,
    loadHistory,
    chatRuns,
    stop,
  } = useGroupChat(threadId);

  const { processes, streaming, chatRuns: polledChatRuns } = useProcessPolling(
    { workspaceId: threadId, threadId: rootMessageId },
    { messages, setMessages },
  );

  const activeChatRuns = useMemo(() => {
    const merged = [...chatRuns];
    for (const pr of polledChatRuns) {
      if (!merged.some((r) => r.chatRunId === pr.chatRunId)) merged.push(pr);
    }
    return merged;
  }, [chatRuns, polledChatRuns]);

  const isWorking =
    activeChatRuns.some((r) => r.status === "queued" || r.status === "running") ||
    processes.some((p) => p.state === "spawning" || p.state === "running");

  const activityStatus: "ready" | "queued" | "working" = isWorking
    ? activeChatRuns.some((r) => r.status === "queued")
      ? "queued"
      : "working"
    : "ready";

  // Load chat history and seed root message for the thread
  const seededRef = useRef(false);
  useEffect(() => {
    loadHistory().then(() => {
      // Seed an invisible root message so the thread exists for history context
      if (!seededRef.current) {
        seededRef.current = true;
        const rootContent = run.output
          ? `[Automation run output]\n\n${run.output}${run.error ? `\n\n[Error]\n${run.error}` : ""}`
          : "[Automation run — no output]";
        const rootMsg: GroupMessage = {
          id: rootMessageId,
          role: "assistant",
          participantId: job.agentId || null,
          content: rootContent,
          timestamp: new Date(run.startedAt ?? run.createdAt).getTime(),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        };
        // Save the root message so the /api/chat backend can find thread history
        fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, messages: [rootMsg] }),
        }).catch((err) => console.warn('[PromptJobBoard] save root message failed:', err));
      }
    });
  }, [loadHistory, threadId, rootMessageId, run, job.agentId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(messages.length);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  const handleSend = useCallback(
    (
      message: string,
      maxRounds: number,
      attachmentIds?: string[],
      _attachments?: unknown[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata,
    ) => {
      // Run output is in the seeded root message — the backend includes it in
      // thread history automatically. Just forward any composer-provided prefix.
      const prefix = promptPrefix;
      const agentIds = orderParticipantIds(
        Array.from(projectAgentIds),
        pinnedParticipantId
      );
      sendMessage(
        message,
        maxRounds,
        undefined, // threadIdOverride
        rootMessageId,
        attachmentIds,
        undefined, // attachmentMetas
        agentIds.length > 0 ? agentIds : undefined,
        undefined, // projectSlug
        prefix,
        routing,
      );
    },
    [sendMessage, projectAgentIds, rootMessageId],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--card-border)] px-4 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--foreground)] truncate">
            Run {run.id.slice(0, 8)}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {run.status}{" "}
            {run.durationMs != null &&
              `· ${(run.durationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4 max-w-none">
          {/* Original run output bubble */}
          {run.output && (
            <div className="flex gap-2.5">
              <div className="shrink-0 mt-0.5">
                {agent ? (
                  <img
                    src={agentAvatar(job.agentId!, agent.color, 28)}
                    alt=""
                    className="size-7 rounded-full"
                  />
                ) : (
                  <div className="flex size-7 items-center justify-center rounded-full bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">
                    <Terminal size={12} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[var(--foreground)]">
                    {agentName ?? job.provider}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)] font-medium uppercase tracking-wider">
                    Run output
                  </span>
                </div>
                <div className="rounded-lg px-3 py-2 text-[12px] leading-[1.55] bg-[var(--muted)] text-[var(--foreground)]">
                  <Markdown content={run.output} />
                </div>
              </div>
            </div>
          )}

          {/* Error bubble */}
          {run.error && (
            <div className="flex gap-2.5">
              <div className="shrink-0 mt-0.5">
                <div className="flex size-7 items-center justify-center rounded-full bg-red-500/10 text-[10px] text-red-400">
                  !
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="rounded-lg px-3 py-2 text-[12px] leading-[1.55] bg-red-500/10 text-red-400">
                  <div className="whitespace-pre-wrap break-words">
                    {run.error}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* No output placeholder */}
          {!run.output && !run.error && (
            <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
              {run.status === "queued"
                ? "Waiting to start..."
                : run.status === "running"
                  ? "Running..."
                  : "No output captured"}
            </div>
          )}

          {/* Follow-up chat messages (exclude the seeded root message) */}
          {messages.filter((m) => m.id !== rootMessageId).map((msg) => {
            const isUser = msg.role === "user";
            const msgAgent = msg.participantId ? agentMap[msg.participantId] : null;
            const msgAgentName = msgAgent?.name ?? agentName ?? job.provider;
            return (
              <div key={msg.id} className="flex gap-2.5">
                <div className="shrink-0 mt-0.5">
                  {isUser ? (
                    <div className="flex size-7 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                      <User size={12} />
                    </div>
                  ) : msgAgent ? (
                    <img
                      src={agentAvatar(msgAgent.id, msgAgent.color, 28)}
                      alt=""
                      className="size-7 rounded-full"
                    />
                  ) : agent ? (
                    <img
                      src={agentAvatar(job.agentId!, agent.color, 28)}
                      alt=""
                      className="size-7 rounded-full"
                    />
                  ) : (
                    <div className="flex size-7 items-center justify-center rounded-full bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">
                      <Terminal size={12} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1">
                    <span className="text-[11px] font-semibold text-[var(--foreground)]">
                      {isUser ? "You" : msgAgentName}
                    </span>
                  </div>
                  <div className={`rounded-lg px-3 py-2 text-[12px] leading-[1.55] ${isUser ? "bg-blue-500/10 text-[var(--foreground)]" : "bg-[var(--muted)] text-[var(--foreground)]"}`}>
                    <Markdown content={stripMarkers(msg.content)} isUser={isUser} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Streaming / typing indicator */}
          {Object.entries(streaming).filter(([, entry]) => entry.rootMessageId === rootMessageId).map(([pid]) => {
            const streamAgent = agentMap[pid] ?? agent;
            return (
              <div key={`streaming-${pid}`} className="flex gap-2.5 animate-in fade-in duration-300">
                <div className="shrink-0 mt-0.5">
                  {streamAgent ? (
                    <img
                      src={agentAvatar(streamAgent.id, streamAgent.color, 28)}
                      alt=""
                      className="size-7 rounded-full"
                    />
                  ) : (
                    <div className="flex size-7 items-center justify-center rounded-full bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">
                      <Sparkles size={12} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {streamAgent?.name ?? "Thinking"}
                    </span>
                    <span className="inline-flex items-center gap-[3px]">
                      <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)]/50 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                      <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)]/50 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
                      <span className="w-1 h-1 rounded-full bg-[var(--muted-foreground)]/50 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer — floating at bottom */}
      <div className="px-3 py-2">
        <Composer
          onSend={handleSend}
          onStop={stop}
          loading={isWorking}
          activityStatus={activityStatus}
          participants={participants}
          commands={[]}
          placeholder="Follow up on this run..."
          initialPinnedParticipantId={job.agentId || undefined}
        />
      </div>
    </div>
  );
}

// ── Detail View (3-panel) ────────────────────────────────────────────────────

function JobDetailView({
  job,
  agentMap,
  onBack,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
  onCancelRun,
  onUpdateAgent,
  fetchRuns,
}: {
  job: PromptJob;
  agentMap: Record<string, AgentOption>;
  onBack: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onCancelRun: () => void;
  onUpdateAgent: (agentId: string) => void;
  fetchRuns: (jobId: string) => Promise<PromptRun[]>;
}) {
  const [runs, setRuns] = useState<PromptRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const agents = Object.values(agentMap);
  const agentName =
    job.agentId && agentMap[job.agentId] ? agentMap[job.agentId].name : null;

  const loadRuns = useCallback(async () => {
    const data = await fetchRuns(job.id);
    setRuns(data);
    if (data.length > 0 && !selectedRunId) setSelectedRunId(data[0].id);
  }, [job.id, fetchRuns, selectedRunId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);
  // Auto-refresh runs
  useEffect(() => {
    const iv = setInterval(loadRuns, UI_POLL_PROMPT_RUNS_MS);
    return () => clearInterval(iv);
  }, [loadRuns]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const isRunning = job.lastOutcome === "running";

  return (
    <div className="h-full flex flex-col text-[var(--foreground)]">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3.5 pt-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--card-border)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <h2 className="text-[13px] font-semibold truncate">{job.name}</h2>
        <span
          className={`inline-block size-2 shrink-0 rounded-full ${statusDotColor[job.state] ?? "bg-zinc-500"}`}
        />
      </div>

      {/* 3-panel content */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: Job details */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-[var(--card-border)] overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={onRunNow}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--card-border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:border-[var(--foreground)] disabled:opacity-50"
              >
                <Play size={11} /> Run now
              </button>
              <button
                onClick={onToggle}
                type="button"
                role="switch"
                aria-checked={job.state === "active"}
                title={job.state === "active" ? "Pause" : "Resume"}
                className={`relative inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer rounded-full border transition-colors ${
                  job.state === "active"
                    ? "border-emerald-400/30 bg-emerald-500/40"
                    : "border-[var(--card-border)] bg-[var(--muted)]"
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-[2px] size-[10px] rounded-full bg-white/90 shadow-sm transition-transform ${
                    job.state === "active"
                      ? "translate-x-[14px]"
                      : "translate-x-[2px]"
                  }`}
                />
              </button>
              {isRunning && (
                <button
                  onClick={onCancelRun}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--card-border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--muted-foreground)] hover:text-red-400 hover:border-red-400/30 transition-colors"
                >
                  Cancel
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={onEdit}
                  title="Edit"
                  className="p-1.5 rounded-md border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition-colors"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={onDelete}
                  title="Delete"
                  className="p-1.5 rounded-md border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-red-400 hover:border-red-400/30 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-1.5">
                Status
              </div>
              <div
                className={`text-[12px] font-semibold ${job.state === "active" ? "text-emerald-400" : job.state === "paused" ? "text-amber-400" : "text-[var(--muted-foreground)]"}`}
              >
                {job.state.charAt(0).toUpperCase() + job.state.slice(1)}
              </div>
            </div>
            <AgentDropdown
              agents={agents}
              value={job.agentId}
              onChange={onUpdateAgent}
            />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-1.5">
                Trigger
              </div>
              <div className="text-[12px] text-[var(--foreground)]">
                {job.triggerType === "condition"
                  ? `Condition (every ${Math.round(job.checkEveryMs / 60000)}m)`
                  : (job.cronExpr && cronToHuman(job.cronExpr)) || job.cadence || job.cronExpr}
              </div>
            </div>
            {job.condition && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-1.5">
                  Condition
                </div>
                <div className="text-[12px] text-[var(--foreground)]">
                  {job.condition}
                </div>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-1.5">
                Instructions
              </div>
              <div className="text-[11px] leading-[1.5] text-[var(--muted-foreground)] whitespace-pre-wrap break-words">
                {job.prompt.length > 200
                  ? job.prompt.slice(0, 200) + "..."
                  : job.prompt}
              </div>
            </div>

            <div className="space-y-1.5">
              {[
                ...(job.overlapPolicy !== "skip"
                  ? [{ l: "Overlap", v: job.overlapPolicy }]
                  : []),
                ...(job.cliArgs ? [{ l: "CLI args", v: job.cliArgs }] : []),
                { l: "Next run", v: formatNextRun(job.nextRunAt, job.state) },
                {
                  l: "Last run",
                  v: job.lastRunAt
                    ? formatDate(new Date(job.lastRunAt).toISOString()) +
                      ` (${job.lastOutcome ?? "—"})`
                    : "Never",
                },
              ].map((item) => (
                <div
                  key={item.l}
                  className="flex items-center justify-between rounded-md border border-[var(--card-border)] bg-[var(--muted)]/50 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="text-[var(--muted-foreground)]">
                    {item.l}
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {item.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MIDDLE: Run history */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--card-border)] overflow-hidden">
          <div className="border-b border-[var(--card-border)] px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              Run History{" "}
              <span className="text-[var(--muted-foreground)]/50">
                {runs.length}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-[var(--muted-foreground)]">
                No runs yet
              </div>
            ) : (
              <div className="flex flex-col">
                {runs.map((run) => {
                  const isSelected = selectedRunId === run.id;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className={`flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2 ${
                        isSelected
                          ? "bg-[var(--foreground)]/5 border-l-[var(--foreground)]"
                          : "border-l-transparent hover:bg-[var(--muted)]/30"
                      }`}
                    >
                      <span
                        className={`mt-1 inline-block size-2 shrink-0 rounded-full ${runStatusDot[run.status] ?? "bg-zinc-500"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[var(--foreground)] truncate">
                          {run.status === "running"
                            ? "Running..."
                            : run.status.charAt(0).toUpperCase() +
                              run.status.slice(1)}
                          {run.durationMs != null &&
                            ` · ${(run.durationMs / 1000).toFixed(1)}s`}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                          <span>
                            {formatDate(run.startedAt ?? run.createdAt)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Selected run output + chat */}
        {selectedRun ? (
          <RunChatPanel
            key={selectedRun.id}
            run={selectedRun}
            job={job}
            agentMap={agentMap}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center text-[var(--muted-foreground)] text-sm">
            {runs.length === 0
              ? 'No runs yet. Click "Run now" to trigger one.'
              : "Select a run to view its output"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export default function PromptJobBoard({
  projectId,
  requireProjectId = false,
}: {
  projectId?: string | null;
  requireProjectId?: boolean;
} = {}) {
  const {
    jobs, loading, refresh,
    createJob,
    updateJob,
    deleteJob,
    toggleJob,
    runNow,
    cancelRun,
    fetchRuns,
  } = usePromptJobs(projectId, { requireProjectId });

  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingJob, setEditingJob] = useState<PromptJob | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [agentMap, setAgentMap] = useState<Record<string, AgentOption>>({});

  useEffect(() => {
    fetch("/api/prompt-jobs/agents")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, AgentOption> = {};
        for (const a of d.agents ?? []) map[a.id] = a;
        setAgentMap(map);
      })
      .catch((err) => console.warn('[PromptJobBoard] fetch agent map failed:', err));
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const filteredJobs = jobs.filter(
    (j) => filter === "all" || j.state === filter,
  );
  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  const counts: Record<string, number> = {
    all: jobs.length,
    active: jobs.filter((j) => j.state === "active").length,
    paused: jobs.filter((j) => j.state === "paused").length,
    stopped: jobs.filter((j) => j.state === "stopped").length,
  };

  const handleToggle = async (job: PromptJob) => {
    const ok = await toggleJob(job);
    if (ok)
      showToast(`${job.name} ${job.state === "active" ? "paused" : "resumed"}`);
  };

  const handleRunNow = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (busy[id]) return;
    setBusy((prev) => ({ ...prev, [id]: true }));
    const ok = await runNow(id);
    setBusy((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (ok) showToast("Run triggered");
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteJob(id);
    if (ok) {
      if (selectedId === id) setSelectedId(null);
      showToast("Job deleted");
    }
  };

  const handleCancelRun = async (id: string) => {
    const ok = await cancelRun(id);
    if (ok) showToast("Run cancelled");
  };

  const handleCreateOrUpdate = async (data: CreateJobData) => {
    if (editingJob) {
      const ok = await updateJob(editingJob.id, data as any);
      if (ok) showToast(`Job "${data.name}" updated`);
    } else {
      const ok = await createJob({ ...data, projectId: projectId ?? '' });
      if (ok) showToast(`Job "${data.name}" created`);
    }
  };

  // Toast overlay (shared across all views)
  const toastEl = toast && (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 text-sm font-medium">
        {toast}
      </div>
    </div>
  );

  // ── Create/Edit view ──
  if (showCreate) {
    return (
      <>
        {toastEl}
        <CreateJobModal
          onClose={() => {
            setShowCreate(false);
            setEditingJob(null);
          }}
          onSubmit={handleCreateOrUpdate}
          editingJob={editingJob}
        />
      </>
    );
  }

  // ── Detail view (3-panel) ──
  if (selected) {
    return (
      <>
        {toastEl}
        <JobDetailView
          job={selected}
          agentMap={agentMap}
          onBack={() => setSelectedId(null)}
          onEdit={() => {
            setEditingJob(selected);
            setShowCreate(true);
          }}
          onToggle={() => handleToggle(selected)}
          onDelete={() => handleDelete(selected.id)}
          onRunNow={() => handleRunNow(selected.id)}
          onCancelRun={() => handleCancelRun(selected.id)}
          onUpdateAgent={async (agentId) => {
            const agent = agentMap[agentId];
            await updateJob(selected.id, {
              agentId,
              provider: agent?.provider ?? "claude",
              model: agent?.model ?? "",
            } as any);
          }}
          fetchRuns={fetchRuns}
        />
      </>
    );
  }

  // ── List view ──
  return (
    <div className="h-full flex flex-col text-[var(--foreground)]">
      {toastEl}

      <div className="px-6 md:px-10 pt-6 pb-0">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">
              Scheduled Tasks
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {counts.active} active job{counts.active !== 1 ? "s" : ""}{" "}
              &middot; {jobs.length} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="p-2 rounded-lg border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition-colors"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => {
                setEditingJob(null);
                setShowCreate(true);
              }}
              className="bg-[var(--foreground)] text-[var(--background)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Plus size={16} /> New Job
            </button>
          </div>
        </div>

        <div className="flex gap-4 border-b border-[var(--card-border)] pb-3">
          {(["all", "active", "paused", "stopped"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-medium pb-1 transition-colors border-b-2 capitalize ${
                filter === f
                  ? "border-[var(--foreground)] text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {f}
              <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)] font-mono">
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 md:px-10 py-6 overflow-y-auto">
        {loading && jobs.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
            Loading jobs...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredJobs.map((job) => {
              const isBusy = busy[job.id];
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className="p-5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--muted-foreground)] transition-all cursor-pointer"
                >
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold truncate mb-1">
                        {job.name}
                      </h3>
                      <StateBadge state={job.state} />
                    </div>
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(job); }}
                        type="button"
                        role="switch"
                        aria-checked={job.state === 'active'}
                        title={job.state === 'active' ? 'Pause' : 'Resume'}
                        className={`relative inline-flex h-[14px] w-[24px] shrink-0 cursor-pointer rounded-full border transition-colors ${
                          job.state === 'active' ? 'border-emerald-400/30 bg-emerald-500/40' : 'border-[var(--card-border)] bg-[var(--muted)]'
                        }`}
                      >
                        <span className={`pointer-events-none absolute top-[1.5px] size-[9px] rounded-full bg-white/90 shadow-sm transition-transform ${
                          job.state === 'active' ? 'translate-x-[11px]' : 'translate-x-[1.5px]'
                        }`} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingJob(job);
                          setShowCreate(true);
                        }}
                        title="Edit"
                        className="p-1.5 rounded-md border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => handleRunNow(job.id, e)}
                        disabled={isBusy}
                        title="Run now"
                        className={`p-1.5 rounded-md border text-[var(--muted-foreground)] transition-colors ${isBusy ? "border-[var(--card-border)] opacity-50 cursor-wait" : "border-[var(--card-border)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)]"}`}
                      >
                        <Play
                          size={12}
                          className={isBusy ? "animate-pulse" : "fill-current"}
                        />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(job.id);
                        }}
                        title="Delete"
                        className="p-1.5 rounded-md border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-red-500 hover:border-red-500/30 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <p className="text-[12px] text-[var(--muted-foreground)] leading-relaxed line-clamp-2 mb-3">
                    {job.prompt}
                  </p>

                  <div className="pt-3 border-t border-[var(--card-border)]/50 flex items-center gap-4 text-[11px] text-[var(--muted-foreground)]">
                    <span className="flex items-center gap-1">
                      {job.agentId && agentMap[job.agentId] ? (
                        <>
                          <img
                            src={agentAvatar(
                              job.agentId,
                              agentMap[job.agentId].color,
                              16,
                            )}
                            alt=""
                            className="size-4 rounded-full"
                          />
                          {agentMap[job.agentId].name}
                        </>
                      ) : (
                        <>
                          <Terminal size={11} />
                          {job.provider}
                        </>
                      )}
                    </span>
                    {job.triggerType === "condition" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-400/20">
                        condition
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatNextRun(job.nextRunAt, job.state)}
                    </span>
                    <span
                      className="ml-auto font-mono truncate max-w-[120px]"
                      title={(job.cronExpr && cronToHuman(job.cronExpr)) || job.cadence || job.cronExpr}
                    >
                      {job.triggerType === "condition"
                        ? `every ${Math.round(job.checkEveryMs / 60000)}m`
                        : (job.cronExpr && cronToHuman(job.cronExpr)) || job.cadence || job.cronExpr}
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredJobs.length === 0 && (
              <div className="md:col-span-2 xl:col-span-3 text-center py-12 text-[var(--muted-foreground)] text-sm border border-dashed border-[var(--card-border)] rounded-xl">
                {jobs.length === 0
                  ? "No prompt jobs yet. Create one to get started."
                  : "No jobs match the selected filter."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

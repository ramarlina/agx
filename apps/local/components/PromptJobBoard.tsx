"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { UI_POLL_PROMPT_RUNS_MS } from "@/lib/constants/timing";
import dynamic from "next/dynamic";
import {
  Play,
  Trash2,
  Plus,
  X,
  Clock,
  Terminal,
  RefreshCw,
  ChevronDown,
  Settings2,
  Pencil,
  User,
  Sparkles,
} from "lucide-react";
import { useUrlSelection } from "@/hooks/useUrlSelection";
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
import { ScheduleConditionPicker } from "@/components/scheduling/ScheduleConditionPicker";

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

function promptTarget(prompt: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "No target";
  return firstLine.replace(/^execute\s+/i, "");
}

function stateDotClass(state: PromptJob["state"]): string {
  if (state === "active") return "bg-emerald-400";
  if (state === "paused") return "bg-amber-400";
  return "bg-zinc-500";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
      {children}
    </div>
  );
}

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
  condition: string;
}

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
  const [cadence, setCadence] = useState(editingJob?.cronExpr || editingJob?.cadence || "");
  const [condition, setCondition] = useState(editingJob?.condition ?? "");
  const [isScheduleValid, setIsScheduleValid] = useState(Boolean(editingJob?.cronExpr || editingJob?.cadence));
  const [catchUpPolicy, setCatchUpPolicy] = useState<'fire_once' | 'replay_all' | 'skip'>(editingJob?.catchUpPolicy ?? 'fire_once');
  const [showAdvanced, setShowAdvanced] = useState(!!editingJob?.cliArgs || (editingJob?.catchUpPolicy != null && editingJob.catchUpPolicy !== 'fire_once'));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || !cadence.trim() || !isScheduleValid) return;
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      agentId,
      provider,
      model: model.trim(),
      cliArgs: cliArgs.trim(),
      catchUpPolicy,
      cadence: cadence.trim(),
      condition: condition.trim(),
    });
    setSubmitting(false);
    onClose();
  };

  const inputClass =
    "w-full bg-[var(--muted)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--foreground)] transition-colors";

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
          disabled={submitting || !name.trim() || !prompt.trim() || !cadence.trim() || !isScheduleValid}
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

          <ScheduleConditionPicker
            value={{ cadence, condition }}
            onChange={(nextValue, meta) => {
              setCadence(nextValue.cadence);
              setCondition(nextValue.condition);
              setIsScheduleValid(meta.isScheduleValid);
            }}
            scheduleLabel="Schedule"
            conditionLabel="Condition"
            conditionHelpText="Scheduled runs and Run now will check this condition before executing."
          />

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
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
  onCancelRun,
  fetchRuns,
}: {
  job: PromptJob;
  agentMap: Record<string, AgentOption>;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onCancelRun: () => void;
  fetchRuns: (jobId: string) => Promise<PromptRun[]>;
}) {
  const [runs, setRuns] = useState<PromptRun[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const { getSelection, pushSelection, replaceSelection } = useUrlSelection();
  const selectedRunId = getSelection("run");
  const agentName =
    job.agentId && agentMap[job.agentId] ? agentMap[job.agentId].name : null;

  const loadRuns = useCallback(async () => {
    setRunsLoaded(false);
    const data = await fetchRuns(job.id);
    setRuns(data);
    setRunsLoaded(true);
  }, [fetchRuns, job.id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);
  // Auto-refresh runs
  useEffect(() => {
    const iv = setInterval(loadRuns, UI_POLL_PROMPT_RUNS_MS);
    return () => clearInterval(iv);
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRunId || !runsLoaded) {
      return;
    }

    if (!runs.some((run) => run.id === selectedRunId)) {
      replaceSelection({ run: null });
    }
  }, [replaceSelection, runs, runsLoaded, selectedRunId]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const isRunning = job.lastOutcome === "running";
  const scheduleLabel =
    (job.cronExpr && cronToHuman(job.cronExpr)) || job.cadence || job.cronExpr;
  const targetLabel = promptTarget(job.prompt);
  const selectedAgent = job.agentId ? agentMap[job.agentId] : null;

  return (
    <div className="h-full flex flex-col text-[var(--foreground)]">
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[420px] shrink-0 flex-col border-r border-[var(--card-border)] overflow-hidden">
          <div className="border-b border-[var(--card-border)] px-6 py-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[18px] font-semibold text-[var(--foreground)]">
                  {job.name}
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onToggle}
                  type="button"
                  role="switch"
                  aria-checked={job.state === "active"}
                  title={job.state === "active" ? "Pause" : "Resume"}
                  className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full border transition-colors ${
                    job.state === "active"
                      ? "border-emerald-400/30 bg-emerald-500/40"
                      : "border-[var(--card-border)] bg-[var(--muted)]"
                  }`}
                >
                  <span
                    className={`pointer-events-none absolute top-[2px] size-[12px] rounded-full bg-white/90 shadow-sm transition-transform ${
                      job.state === "active"
                        ? "translate-x-[16px]"
                        : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <button
                  onClick={onRunNow}
                  disabled={isRunning}
                  title="Run now"
                  className="rounded-md border border-[var(--card-border)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  <Play size={12} className="fill-current" />
                </button>
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-0">
              <div className="px-6 py-5">
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-4">
                  <div className="grid grid-cols-[96px,minmax(0,1fr)] items-center gap-x-4 gap-y-4">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                      Agent
                    </div>
                    <div className="min-w-0 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2.5">
                        {selectedAgent ? (
                          <img
                            src={agentAvatar(selectedAgent.id, selectedAgent.color, 20)}
                            alt=""
                            className="size-5 rounded-full shrink-0"
                          />
                        ) : (
                          <Terminal size={14} className="shrink-0 text-[var(--muted-foreground)]" />
                        )}
                        <div className="truncate text-[13px] font-medium text-[var(--foreground)]">
                          {agentName ?? job.provider}
                          {job.model ? ` (${job.provider} / ${job.model})` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                      Schedule
                    </div>
                    <div className="truncate text-[13px] font-medium text-[var(--foreground)]">
                      {scheduleLabel || "—"}
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                      Target
                    </div>
                    <div
                      className="truncate font-mono text-[13px] text-[var(--foreground)]"
                      title={targetLabel}
                    >
                      {targetLabel}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--card-border)]">
                <div className="flex items-center justify-between px-6 py-4">
                  <SectionLabel>Recent Runs</SectionLabel>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {runs.length} total
                  </span>
                </div>
                <div>
                  {runs.length === 0 ? (
                    <div className="px-6 py-10 text-center text-[11px] text-[var(--muted-foreground)]">
                      No runs yet
                    </div>
                  ) : (
                    runs.map((run) => {
                      const isSelected = selectedRunId === run.id;
                      const isSuccessful = run.status === "success";
                      return (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => pushSelection({ run: run.id })}
                          className={`flex w-full items-center gap-4 border-t border-[var(--card-border)]/50 px-6 py-5 text-left transition-colors ${
                            isSelected
                              ? "border-l-2 border-l-emerald-400 bg-emerald-500/5"
                              : "hover:bg-[var(--muted)]/20"
                          }`}
                        >
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                              isSuccessful
                                ? "border-emerald-400 text-emerald-400"
                                : run.status === "failed"
                                  ? "border-red-400 text-red-400"
                                  : run.status === "running"
                                    ? "border-sky-400 text-sky-400"
                                    : "border-[var(--card-border)] text-[var(--muted-foreground)]"
                            }`}
                          >
                            {isSuccessful ? "✓" : run.status === "failed" ? "!" : "•"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-[var(--foreground)]">
                              {formatDate(run.startedAt ?? run.createdAt)}
                            </div>
                            <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                              {run.durationMs != null
                                ? `${(run.durationMs / 1000).toFixed(1)}s`
                                : run.status === "running"
                                  ? "Running..."
                                  : run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                            </div>
                          </div>
                          {isSelected ? (
                            <span className="rounded-md bg-[var(--muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                              Viewing
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--card-border)] px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {isRunning ? (
                    <button
                      onClick={onCancelRun}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-400/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      Cancel run
                    </button>
                  ) : null}
                  {job.condition ? (
                    <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                      gated
                    </span>
                  ) : null}
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    Next run {formatNextRun(job.nextRunAt, job.state)}
                  </span>
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    Last {job.lastRunAt ? formatDate(new Date(job.lastRunAt).toISOString()) : "Never"}
                  </span>
                  {(job.cliArgs || job.overlapPolicy !== "skip") && (
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {job.cliArgs ? "Custom CLI args" : `Overlap ${job.overlapPolicy}`}
                    </span>
                  )}
                </div>
                {job.condition ? (
                  <div className="mt-3 text-[11px] leading-[1.5] text-[var(--muted-foreground)]">
                    {job.condition}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

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
  const [selectedJobFallback, setSelectedJobFallback] = useState<PromptJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingJob, setEditingJob] = useState<PromptJob | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [agentMap, setAgentMap] = useState<Record<string, AgentOption>>({});
  const { getSelection, pushSelection, replaceSelection } = useUrlSelection();
  const selectedId = getSelection("job");
  const selectedRunId = getSelection("run");

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

  const filteredJobs = jobs.filter((j) => filter === "all" || j.state === filter);
  const selectedFromList = selectedId ? jobs.find((j) => j.id === selectedId) ?? null : null;
  const selected =
    selectedFromList ??
    (selectedJobFallback?.id === selectedId ? selectedJobFallback : null);

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
      if (selectedId === id) {
        pushSelection({ job: null, run: null });
      }
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

  useEffect(() => {
    if (!selectedId) {
      setSelectedJobFallback(null);
      if (selectedRunId) {
        replaceSelection({ run: null });
      }
      return;
    }

    if (selectedFromList) {
      setSelectedJobFallback((current) => (current?.id === selectedId ? selectedFromList : null));
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/prompt-jobs/${encodeURIComponent(selectedId)}`);
        if (cancelled) return;

        if (response.status === 404) {
          replaceSelection({ job: null, run: null });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch selected scheduled task: ${response.status}`);
        }

        const payload = (await response.json().catch(() => ({}))) as { job?: PromptJob };
        if (!payload.job?.id) {
          replaceSelection({ job: null, run: null });
          return;
        }

        setSelectedJobFallback(payload.job);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to hydrate selected prompt job", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceSelection, selectedFromList, selectedId, selectedRunId]);

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

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--foreground)] lg:flex-row">
      {toastEl}

      <div className="flex w-full shrink-0 flex-col border-b border-[var(--card-border)] lg:w-[390px] lg:border-b-0 lg:border-r">
        <div className="px-6 pb-0 pt-6">
          <div className="border-b border-[var(--card-border)]">
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-end gap-10">
                {(["all", "active", "paused"] as const).map((f) => {
                  const isActive = filter === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`relative pb-4 text-[18px] font-semibold capitalize transition-colors ${
                        isActive
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {f}
                      {isActive ? (
                        <span className="absolute bottom-[6px] left-0 h-[4px] w-8 rounded-full bg-[var(--foreground)]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-5 pb-4 text-[var(--muted-foreground)]">
                <button
                  onClick={() => refresh()}
                  className="transition-colors hover:text-[var(--foreground)]"
                  title="Refresh"
                >
                  <RefreshCw size={18} />
                </button>
                <button
                  onClick={() => {
                    setEditingJob(null);
                    setShowCreate(true);
                  }}
                  className="transition-colors hover:text-[var(--foreground)]"
                  title="New Job"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-5">
          {loading && jobs.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              Loading jobs...
            </div>
          ) : (
            <div className="overflow-hidden">
              {filteredJobs.map((job) => {
                const isSelected = selectedId === job.id;
                const scheduleLabel =
                  (job.cronExpr && cronToHuman(job.cronExpr)) || job.cadence || job.cronExpr;
                return (
                  <div
                    key={job.id}
                    onClick={() => pushSelection({ job: job.id, run: null })}
                    className={`cursor-pointer border-b border-[var(--card-border)]/50 px-6 py-4 transition-colors ${
                      isSelected
                        ? "bg-[var(--card-bg)]"
                        : "hover:bg-[var(--muted)]/10"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium text-[var(--foreground)]">
                          {job.name}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--muted-foreground)]">
                          <span className="min-w-0 flex items-center gap-1.5 truncate">
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
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatNextRun(job.nextRunAt, job.state)}
                          </span>
                          <span
                            className="truncate font-mono text-[11px]"
                            title={scheduleLabel}
                          >
                            {scheduleLabel}
                          </span>
                          {job.condition ? (
                            <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                              gated
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span
                        className={`mt-1 inline-block size-2 shrink-0 rounded-full ${stateDotClass(job.state)}`}
                      />
                    </div>
                  </div>
                );
              })}

              {filteredJobs.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--card-border)] py-12 text-center text-sm text-[var(--muted-foreground)]">
                  {jobs.length === 0
                    ? "No prompt jobs yet. Create one to get started."
                    : "No jobs match the selected filter."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        {selected ? (
          <JobDetailView
            key={selected.id}
            job={selected}
            agentMap={agentMap}
            onEdit={() => {
              setEditingJob(selected);
              setShowCreate(true);
            }}
            onToggle={() => handleToggle(selected)}
            onDelete={() => handleDelete(selected.id)}
            onRunNow={() => handleRunNow(selected.id)}
            onCancelRun={() => handleCancelRun(selected.id)}
            fetchRuns={fetchRuns}
          />
        ) : (
          <div className="flex h-full items-center justify-center border-t border-[var(--card-border)] lg:border-l-0 lg:border-t-0">
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)]/60 px-8 py-10 text-center">
              <div className="text-sm font-medium text-[var(--foreground)]">
                Select a scheduled task
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                The selected job will open here with its runs and chat output.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

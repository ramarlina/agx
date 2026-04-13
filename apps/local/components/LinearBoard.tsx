"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock, ExternalLink, FileText, Link2, Play, Plus, RefreshCw, Search, Settings, User } from "lucide-react";
import { useUrlSelection } from "@/hooks/useUrlSelection";
import { useLinearIssues, type LinearIssue } from "@/hooks/useLinearIssues";
import { useLinearConnection } from "@/hooks/useLinearConnection";
import { useLinearRuns, type LinearRun } from "@/hooks/useLinearRuns";
import { useLinearRunScripts } from "@/hooks/useLinearRunScripts";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { Markdown } from "@/components/chat-ui/Markdown";
import RunScriptManager from "@/components/linear/RunScriptManager";
import { stripMarkers } from "@/lib/chat-utils";
import {
  loadLinearBoardFilters,
  persistLinearBoardFilters,
} from "@/state/linearBoardFilters";
import {
  loadLinearTicketPanelWidth,
  persistLinearTicketPanelWidth,
  loadLinearRunsPanelWidth,
  persistLinearRunsPanelWidth,
} from "@/state/windowState";
import {
  orderParticipantIds,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import type { Participant } from "@/lib/types";
import LinearSetup from "@/components/LinearSetup";

const Composer = dynamic(
  () => import("@/components/chat-ui/Composer").then((module) => module.Composer),
  { ssr: false }
);

function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    if (!dragging.current) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onResize(delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  });

  return (
    <div
      className="group relative z-10 w-0 shrink-0 cursor-col-resize"
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
    >
      <div className="absolute inset-y-0 -left-0.5 w-1 transition-colors group-hover:bg-[var(--primary)]/40" />
    </div>
  );
}

function agentAvatarUrl(id: string, color?: string, size = 20): string {
  const bg = color ? color.replace("#", "") : "e2e8f0";
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(id)}&size=${size}&backgroundColor=${bg}`;
}

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function openLinearIssueTab(issueUrl: string): void {
  const opened = window.open(issueUrl, "_blank", "noopener,noreferrer");
  opened?.focus();
}

type RunDisplayTone = LinearRun["status"] | "ready";

function formatRunStatus(status: LinearRun["status"]): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

function getRunDisplayState(run: LinearRun): {
  label: string;
  tone: RunDisplayTone;
} {
  if (run.mode === "chat") {
    switch (run.status) {
      case "queued":
        return { label: "starting", tone: "queued" };
      case "running":
        return { label: "thinking", tone: "running" };
      case "success":
        return { label: "ready", tone: "ready" };
      case "failed":
        return { label: "error", tone: "failed" };
      case "cancelled":
        return { label: "stopped", tone: "cancelled" };
      default:
        return { label: formatRunStatus(run.status), tone: run.status };
    }
  }

  return { label: formatRunStatus(run.status), tone: run.status };
}

function getRunTitle(run: LinearRun): string {
  const title = run.sessionTitle?.trim();
  if (title) {
    return title;
  }
  return run.mode === "scripted" ? "Scripted session" : "Chat session";
}

const STATUS_LABELS: Record<string, string> = {
  "In Progress": "In Prog",
  "In Review": "Review",
  Backlog: "Backlog",
  Todo: "Todo",
  Done: "Done",
  Cancelled: "Cancl.",
};

const STATUS_BADGE_STYLES: Record<RunDisplayTone, string> = {
  queued: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  running: "bg-yellow-500/10 border-yellow-500/20 text-yellow-400",
  ready: "bg-sky-500/10 border-sky-500/20 text-sky-400",
  success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/10 border-red-500/20 text-red-400",
  cancelled: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
};

const STATUS_DOT_COLORS: Record<RunDisplayTone, string> = {
  queued: "bg-amber-400",
  running: "bg-yellow-400",
  ready: "bg-sky-400",
  success: "bg-emerald-400",
  failed: "bg-red-400",
  cancelled: "bg-zinc-400",
};

const STATUS_TEXT_COLORS: Record<RunDisplayTone, string> = {
  queued: "text-amber-500",
  running: "text-yellow-500",
  ready: "text-sky-500",
  success: "text-green-500",
  failed: "text-red-500",
  cancelled: "text-[var(--muted-foreground)]",
};

const NEW_SESSION_PANEL_ID = "new";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: FilterOption[];
  activeClasses: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface FilterPopdownProps extends FilterSelectProps {
  emptyLabel?: string;
}

interface MultiFilterPopdownProps {
  label: string;
  values: string[];
  options: FilterOption[];
  activeClasses: string;
  onChange: (value: string[]) => void;
  emptyLabel?: string;
}

function FilterSelect({
  label,
  value,
  options,
  activeClasses,
  onChange,
  disabled = false,
}: FilterSelectProps) {
  const isActive = value.trim().length > 0;

  return (
    <div className="relative">
      <select
        aria-label={label}
        className={`max-w-[160px] appearance-none rounded-full border bg-transparent px-2.5 py-0.5 pr-6 text-[11px] font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${label}-${option.value || "all"}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-current"
      />
    </div>
  );
}

function IssueStatusSelect({
  status,
  options,
  onChange,
  disabled = false,
  updating = false,
}: {
  status: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  updating?: boolean;
}) {
  return (
    <div className="relative">
      <select
        aria-label="Ticket status"
        className="max-w-[160px] appearance-none rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 pr-8 text-xs font-medium text-[var(--foreground)] outline-none transition-colors hover:border-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        value={status}
        disabled={disabled || updating}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`ticket-status-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {updating ? (
        <RefreshCw
          size={12}
          className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 animate-spin text-[var(--muted-foreground)]"
        />
      ) : null}
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
      />
    </div>
  );
}

function FilterPopdown({
  label,
  value,
  options,
  activeClasses,
  onChange,
  emptyLabel,
}: FilterPopdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const isActive = value.trim().length > 0;
  const buttonLabel = selectedOption?.label ?? emptyLabel ?? label;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [value]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[180px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="max-w-[132px] truncate">{buttonLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-lg backdrop-blur-sm"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={`${label}-${option.value || "all"}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => onChange(option.value)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-[var(--card-border)]"
                  }`}
                >
                  {isSelected ? <Check size={10} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MultiFilterPopdown({
  label,
  values,
  options,
  activeClasses,
  onChange,
  emptyLabel,
}: MultiFilterPopdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedOptions = options.filter(
    (option) => option.value && values.includes(option.value)
  );
  const isActive = selectedOptions.length > 0;
  const buttonLabel = (() => {
    if (selectedOptions.length === 0) {
      return emptyLabel ?? label;
    }
    if (selectedOptions.length === options.length) {
      return emptyLabel ?? label;
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0]?.label ?? (emptyLabel ?? label);
    }
    const lowerLabel = label.toLowerCase();
    return `${selectedOptions.length} ${lowerLabel}${lowerLabel.endsWith("s") ? "es" : "s"}`;
  })();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const toggleValue = useCallback(
    (nextValue: string) => {
      if (!nextValue) {
        onChange([]);
        return;
      }

      const nextValues = values.includes(nextValue)
        ? values.filter((value) => value !== nextValue)
        : [...values, nextValue];
      onChange(nextValues);
    },
    [onChange, values]
  );

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[180px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="max-w-[132px] truncate">{buttonLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`${label} options`}
          aria-multiselectable="true"
          className="absolute left-0 top-full z-50 mt-1 min-w-[240px] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-lg backdrop-blur-sm"
        >
          <button
            type="button"
            role="option"
            aria-selected={!isActive}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
              !isActive
                ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => onChange([])}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                !isActive
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-[var(--card-border)]"
              }`}
            >
              {!isActive ? <Check size={10} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{emptyLabel ?? label}</span>
          </button>
          {selectedOptions.length > 0 ? (
            <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              Selected
            </div>
          ) : null}
          {options.filter((option) => option.value).map((option) => {
            const isSelected = values.includes(option.value);
            return (
              <button
                key={`${label}-${option.value}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => toggleValue(option.value)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-[var(--card-border)]"
                  }`}
                >
                  {isSelected ? <Check size={10} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface CycleOption {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
}

interface LinearEntityOption {
  id: string;
  name: string;
}

function TicketChatStarter({
  issue,
  participants,
  projectId,
  projectSlug,
  issueStatusOptions,
  issueStatusUpdating,
  onIssueStatusChange,
  activeSessionScriptLabel,
  onOpenSessionScripts,
  onStartScriptedSession,
  createRun,
  updateRun,
  onRunCreated,
}: {
  issue: LinearIssue;
  participants: Participant[];
  projectId?: string;
  projectSlug?: string;
  issueStatusOptions: FilterOption[];
  issueStatusUpdating: boolean;
  onIssueStatusChange: (issue: LinearIssue, status: string) => void;
  activeSessionScriptLabel: string;
  onOpenSessionScripts: () => void;
  onStartScriptedSession: (event: React.MouseEvent<HTMLButtonElement>) => void;
  createRun: (input: {
    projectId: string | null;
    projectSlug: string | null;
    issueId: string;
    issueIdentifier: string;
    issueTitle: string;
    issueStatus: string;
    issueAssignee: string | null;
    agentId: string;
    agentName: string;
    mode: LinearRun["mode"];
  }) => Promise<LinearRun>;
  updateRun: (id: string, input: {
    rootMessageId?: string | null;
    chatRunId?: string | null;
    status?: LinearRun["status"];
    error?: string | null;
  }) => Promise<LinearRun>;
  onRunCreated: (runId: string) => void;
}) {
  const defaultAgent = participants[0];
  const sessionScriptButtonLabel =
    activeSessionScriptLabel === "AGX default" ? "Session script" : activeSessionScriptLabel;
  const threadIdRef = useRef(crypto.randomUUID());
  const { messages, setMessages, sendMessage, chatRuns } = useGroupChat(threadIdRef.current);
  const { processes, streaming } = useProcessPolling(
    { workspaceId: threadIdRef.current },
    { messages, setMessages }
  );

  const activeRunStatuses = new Set(["queued", "running", "awaiting_user", "blocked"]);
  const isWorking =
    chatRuns.some((entry) => activeRunStatuses.has(entry.status)) ||
    processes.some((process) => process.state === "spawning" || process.state === "running");
  const activityStatus: "ready" | "queued" | "working" = isWorking
    ? chatRuns.some((entry) => entry.status === "queued")
      ? "queued"
      : "working"
    : "ready";

  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants]
  );

  const creatingRef = useRef(false);

  const handleSend = useCallback(
    async (
      message: string,
      maxRounds: number,
      _attachmentIds?: string[],
      _attachments?: unknown[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      if (creatingRef.current) return;
      creatingRef.current = true;

      const agent = (pinnedParticipantId ? participants.find((p) => p.id === pinnedParticipantId) : null) ?? defaultAgent;
      if (!agent) return;

      try {
        const { promptPrefix: ticketPrefix } = buildLinearExecutionPrompt({
          issue: {
            identifier: issue.identifier,
            title: issue.title,
            status: issue.status,
            assignee: issue.assignee,
          },
          project: projectSlug ? { slug: projectSlug } : null,
        });

        const combinedPrefix = ticketPrefix + (promptPrefix ? `\n${promptPrefix}` : "");

        const run = await createRun({
          projectId: projectId ?? null,
          projectSlug: projectSlug ?? null,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          issueStatus: issue.status,
          issueAssignee: issue.assignee ?? null,
          agentId: agent.id,
          agentName: agent.name,
          mode: "chat",
        });

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: message,
            promptPrefix: combinedPrefix,
            threadId: run.threadId,
            activeParticipantIds: [agent.id],
            projectSlug: projectSlug ?? undefined,
            routing,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          chatRunId?: string;
          userMessageId?: string;
        };

        if (!response.ok || !payload.chatRunId || !payload.userMessageId) {
          throw new Error(payload.error || "Failed to start chat session");
        }

        await updateRun(run.id, {
          chatRunId: payload.chatRunId,
          rootMessageId: payload.userMessageId,
        });

        onRunCreated(run.id);
      } catch (error) {
        console.error("Failed to create chat session:", error);
        creatingRef.current = false;
        if (error instanceof Error) {
          window.alert(error.message);
        }
      }
    },
    [issue, participants, defaultAgent, projectId, projectSlug, createRun, updateRun, onRunCreated]
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--card-border)] px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-sm text-[var(--muted-foreground)]">
            {issue.identifier}
          </span>
          <div className="h-1 w-1 shrink-0 rounded-full bg-[var(--card-border)]" />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {issue.title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IssueStatusSelect
            status={issue.status}
            options={issueStatusOptions}
            disabled={issueStatusOptions.length === 0}
            updating={issueStatusUpdating}
            onChange={(status) => onIssueStatusChange(issue, status)}
          />
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
            onClick={onOpenSessionScripts}
            title={`Session script: ${activeSessionScriptLabel}. Choose or edit the kickoff prompt for this ticket.`}
          >
            <FileText size={12} />
            <span className="max-w-[120px] truncate">{sessionScriptButtonLabel}</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600"
            onClick={onStartScriptedSession}
          >
            <Play size={12} />
            <span>Start scripted session</span>
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 pb-64">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]">
            <span className="text-sm">Start a new session for this ticket</span>
            <span className="text-xs">Type a message to open a chat, or launch the active session script.</span>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-8">
            {messages.map((msg) => {
              const participant = msg.participantId ? participantMap.get(msg.participantId) : null;
              const content = stripMarkers(msg.content);
              if (!content.trim()) return null;
              return (
                <div key={msg.id} className="flex gap-3">
                  {msg.role === "user" ? (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-shell-subtle,var(--card-bg))]">
                      <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </div>
                  ) : (
                    <img
                      src={agentAvatarUrl(msg.participantId ?? "", participant?.color)}
                      alt={participant?.name ?? "Agent"}
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-[var(--foreground)]">
                      {msg.role === "user" ? "You" : participant?.name ?? "Agent"}
                    </span>
                    <div className="text-sm text-[var(--foreground)]">
                      <Markdown content={content} isUser={msg.role === "user"} />
                    </div>
                  </div>
                </div>
              );
            })}
            {Object.entries(streaming).map(([participantId]) => {
              const participant = participantMap.get(participantId);
              return (
                <div key={`stream-${participantId}`} className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
                  <img
                    src={agentAvatarUrl(participantId, participant?.color)}
                    alt={participant?.name ?? "Agent"}
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                  {participant?.name ?? "Agent"} is thinking...
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 right-3 p-2">
        <Composer
          onSend={handleSend}
          onStop={() => {}}
          participants={participants}
          projectSlug={projectSlug ?? undefined}
          loading={activityStatus !== "ready"}
          commands={[]}
          activityStatus={activityStatus}
          placeholder={`Ask about ${issue.identifier}...`}
          initialPinnedParticipantId={defaultAgent?.id}
        />
      </div>
    </div>
  );
}

function ThreadMessageList({
  issue,
  run,
  participants,
  issueStatusOptions,
  issueStatusUpdating,
  onIssueStatusChange,
}: {
  issue: LinearIssue;
  run: LinearRun;
  participants: Participant[];
  issueStatusOptions: FilterOption[];
  issueStatusUpdating: boolean;
  onIssueStatusChange: (issue: LinearIssue, status: string) => void;
}) {
  const { messages, setMessages, sendMessage, loadHistory, stop } = useGroupChat(
    run.threadId
  );
  const { processes, streaming, chatRuns } = useProcessPolling(
    run.rootMessageId
      ? { workspaceId: run.threadId, threadId: run.rootMessageId }
      : { workspaceId: run.threadId },
    { messages, setMessages }
  );

  // Derive display status from the most recent chat run (reflects last agent message),
  // falling back to the overall run status.
  const runDisplay = useMemo(() => {
    const latestChatRun = chatRuns[0];
    if (!latestChatRun) return getRunDisplayState(run);
    const mappedStatus: Record<string, LinearRun["status"]> = {
      queued: "queued",
      running: "running",
      awaiting_user: "running",
      blocked: "running",
      completed: "success",
      failed: "failed",
      cancelled: "cancelled",
    };
    const status = mappedStatus[latestChatRun.status] ?? run.status;
    return getRunDisplayState({ ...run, status });
  }, [chatRuns, run]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, run.threadId]);

  const participantMap = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants]
  );

  const activeRunStatuses = new Set(["queued", "running", "awaiting_user", "blocked"]);
  const isWorking =
    chatRuns.some((entry) => activeRunStatuses.has(entry.status)) ||
    processes.some((process) => process.state === "spawning" || process.state === "running");
  const activityStatus: "ready" | "queued" | "working" = isWorking
    ? chatRuns.some((entry) => entry.status === "queued")
      ? "queued"
      : "working"
    : "ready";

  const handleSend = useCallback(
    (
      message: string,
      maxRounds: number,
      attachmentIds?: string[],
      _attachments?: unknown[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      if (!run.rootMessageId) {
        return;
      }

      void sendMessage(
        message,
        maxRounds,
        undefined,
        run.rootMessageId,
        attachmentIds,
        undefined,
        orderParticipantIds(
          participants.map((participant) => participant.id),
          pinnedParticipantId
        ),
        run.projectSlug ?? undefined,
        promptPrefix,
        routing
      );
    },
    [participants, run.projectSlug, run.rootMessageId, sendMessage]
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Merged header: ticket info + session status */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--card-border)] px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-sm text-[var(--muted-foreground)]">
            {issue.identifier}
          </span>
          <div className="h-1 w-1 shrink-0 rounded-full bg-[var(--card-border)]" />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {getRunTitle(run)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <IssueStatusSelect
            status={issue.status}
            options={issueStatusOptions}
            disabled={issueStatusOptions.length === 0}
            updating={issueStatusUpdating}
            onChange={(status) => onIssueStatusChange(issue, status)}
          />
          <div
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1 ${STATUS_BADGE_STYLES[runDisplay.tone]}`}
          >
            <div className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[runDisplay.tone]}`} />
            <span className="text-xs font-semibold uppercase tracking-wider">
              {runDisplay.label}
            </span>
          </div>

          {run.durationMs != null && (
            <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
              <Clock size={14} />
              <span>{(run.durationMs / 1000).toFixed(1)}s</span>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1">
            <img
              src={agentAvatarUrl(run.agentId, participantMap.get(run.agentId)?.color)}
              alt={run.agentName}
              className="h-5 w-5 rounded-full object-cover"
            />
            <span className="pr-1 text-xs font-medium">{run.agentName}</span>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 pb-64">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">
            {run.status === "queued" || run.status === "running"
              ? "Starting session..."
              : "No thread messages yet."}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-8">
            {messages.map((message) => {
              const participant = message.participantId
                ? participantMap.get(message.participantId)
                : null;
              const content = stripMarkers(message.content);
              if (!content.trim()) return null;

              const agentId = message.participantId ?? run.agentId;

              return (
                <div key={message.id} className="flex gap-3">
                  {/* Avatar */}
                  {message.role === "user" ? (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-shell-subtle,var(--card-bg))]">
                      <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </div>
                  ) : (
                    <img
                      src={agentAvatarUrl(agentId, participant?.color)}
                      alt={participant?.name ?? run.agentName}
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                  )}

                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {message.role === "user" ? (
                          <span className="text-sm font-semibold text-[var(--foreground)]">You</span>
                        ) : (
                          <>
                            <span
                              className="text-sm font-semibold"
                              style={{ color: participant?.color ?? "var(--foreground)" }}
                            >
                              {participant?.name ?? run.agentName}
                            </span>
                            <span className="rounded bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                              Agent
                            </span>
                          </>
                        )}
                      </div>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {message.role === "user" ? (
                      <div className="w-fit max-w-[85%] rounded-xl rounded-tl-sm border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--foreground)]">
                        <Markdown content={content} isUser />
                      </div>
                    ) : (
                      <div className="text-sm text-[var(--foreground)]">
                        <Markdown content={content} isUser={false} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {Object.entries(streaming)
              .filter(([, entry]) => !run.rootMessageId || entry.rootMessageId === run.rootMessageId)
              .map(([participantId]) => {
                const participant = participantMap.get(participantId);
                return (
                  <div key={`stream-${participantId}`} className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
                    <img
                      src={agentAvatarUrl(participantId, participant?.color)}
                      alt={participant?.name ?? run.agentName}
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                    {participant?.name ?? run.agentName} is thinking...
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 right-3 p-2">
        {run.rootMessageId ? (
          <Composer
            onSend={handleSend}
            onStop={stop}
            participants={participants}
            projectSlug={run.projectSlug ?? undefined}
            loading={activityStatus !== "ready"}
            commands={[]}
            activityStatus={activityStatus}
            placeholder="Continue this session..."
            initialPinnedParticipantId={run.agentId}
          />
        ) : (
          <div className="px-2 py-1 text-xs text-[var(--muted-foreground)]">
            Waiting for the session to start...
          </div>
        )}
      </div>
    </div>
  );
}

function TicketRow({
  issue,
  selected,
  onSelect,
  activeAgents,
  participants,
}: {
  issue: LinearIssue;
  selected: boolean;
  onSelect: () => void;
  activeAgents?: Array<{ agentId: string; agentName: string }>;
  participants?: Participant[];
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyUrl = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!issue.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issue.url);
      setCopied(true);
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1500) as unknown as number;
    } catch (error) {
      console.error("Failed to copy Linear issue URL:", error);
      setCopied(false);
    }
  }, [issue.url]);

  const handleOpenIssue = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!issue.url) {
      return;
    }
    openLinearIssueTab(issue.url);
  }, [issue.url]);

  const shortStatus = STATUS_LABELS[issue.status] ?? issue.status.slice(0, 6);
  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        selected
          ? "bg-[var(--card-bg)]"
          : "hover:bg-[var(--card-bg)]/50"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full bg-blue-500" />
      )}
      <span className="w-24 shrink-0 whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
        {issue.identifier}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${selected ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
        {issue.title}
      </span>
      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
        {shortStatus}
      </span>
      {activeAgents && activeAgents.length > 0 && (
        <span className="inline-flex items-center -space-x-1 shrink-0">
          {activeAgents.slice(0, 3).map((agent) => {
            const participant = participants?.find((p) => p.id === agent.agentId);
            return (
              <span key={agent.agentId} className="relative inline-block" title={participant?.name ?? agent.agentName}>
                <img src={agentAvatarUrl(agent.agentId, participant?.color, 16)} alt={participant?.name ?? agent.agentName} className="h-3 w-3 rounded-full ring-[1.5px] ring-[var(--app-shell-pane)]" />
                <span className="absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full bg-green-500 ring-[1px] ring-[var(--app-shell-pane)]" />
              </span>
            );
          })}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${issue.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={(event) => {
            void handleCopyUrl(event);
          }}
          title={copied ? "Copied ticket URL" : "Copy ticket URL"}
          aria-label={copied ? "Copied ticket URL" : "Copy ticket URL"}
          disabled={!issue.url}
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Link2 size={10} />}
        </button>
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${issue.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={handleOpenIssue}
          title={issue.url ? "Open this Linear ticket in a new tab" : "This ticket does not have a Linear URL"}
          aria-label={issue.url ? "Open this Linear ticket in a new tab" : "This ticket does not have a Linear URL"}
          disabled={!issue.url}
        >
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
}

interface LinearBoardProps {
  projectId?: string;
  projectSlug?: string;
  initialShowSettings?: boolean;
}

export default function LinearBoard({ projectId, projectSlug, initialShowSettings }: LinearBoardProps) {
  const {
    connected,
    loading: connectionLoading,
    user,
    clis,
    mcpConfigured,
    connect,
    connectWithKey,
    disconnect,
    configureMcp,
  } = useLinearConnection();

  const [setupDismissed, setSetupDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(initialShowSettings ?? false);
  const [showRunScripts, setShowRunScripts] = useState(false);
  const [ticketPanelWidth, setTicketPanelWidth] = useState(() => loadLinearTicketPanelWidth() || 576);
  const [runsPanelWidth, setRunsPanelWidth] = useState(() => loadLinearRunsPanelWidth() || 224);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);
  const [assignees, setAssignees] = useState<LinearEntityOption[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<LinearEntityOption[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [sortBy, setSortBy] = useState<"activity" | "identifier" | "status" | "created">("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hasActivity, setHasActivity] = useState(false);
  const [selectedIssueFallback, setSelectedIssueFallback] = useState<LinearIssue | null>(null);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [issueActiveAgents, setIssueActiveAgents] = useState<Map<string, Array<{ agentId: string; agentName: string }>>>(new Map());
  const [pickerIssue, setPickerIssue] = useState<LinearIssue | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFilterPersistRef = useRef(true);
  const runScriptsButtonRef = useRef<HTMLButtonElement | null>(null);
  const runScriptsPanelRef = useRef<HTMLDivElement | null>(null);
  const { getSelection, pushSelection, replaceSelection } = useUrlSelection();
  const selectedIssueId = getSelection("issue");
  const selectedRunId = getSelection("run");

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const storedFilters = loadLinearBoardFilters(projectSlug);
    skipNextFilterPersistRef.current = true;
    setSearch(storedFilters.search);
    setDebouncedSearch(storedFilters.search);
    setSelectedAssigneeIds(storedFilters.assigneeIds);
    setSelectedStatuses(storedFilters.statuses);
    setSelectedWorkspaceId(storedFilters.teamId);
    setSelectedCycleId(storedFilters.cycleId);
    setSortBy(storedFilters.sortBy);
    setSortDir(storedFilters.sortDir);
    setHasActivity(storedFilters.hasActivity);
  }, [projectSlug]);

  useEffect(() => {
    if (skipNextFilterPersistRef.current) {
      skipNextFilterPersistRef.current = false;
      return;
    }

    persistLinearBoardFilters(projectSlug, {
      search,
      assigneeIds: selectedAssigneeIds,
      statuses: selectedStatuses,
      teamId: selectedWorkspaceId,
      cycleId: selectedCycleId,
      sortBy,
      sortDir,
      hasActivity,
    });
  }, [projectSlug, search, selectedAssigneeIds, selectedStatuses, selectedWorkspaceId, selectedCycleId, sortBy, sortDir, hasActivity]);

  // Fetch filter options when connected
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setFilterOptionsLoaded(false);
    const params = new URLSearchParams();
    if (projectSlug) {
      params.set("projectSlug", projectSlug);
    }
    const url = params.size > 0 ? `/api/linear/options?${params.toString()}` : "/api/linear/options";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        setAssignees(Array.isArray(data.assignees) ? data.assignees : []);
        setStatuses(Array.isArray(data.statuses) ? data.statuses : []);
        setWorkspaces(Array.isArray(data.teams) ? data.teams : []);
        setCycles(Array.isArray(data.cycles) ? data.cycles : []);
        setFilterOptionsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAssignees([]);
          setStatuses([]);
          setWorkspaces([]);
          setCycles([]);
          setFilterOptionsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connected, projectSlug]);

  useEffect(() => {
    if (!filterOptionsLoaded) {
      return;
    }
    const validAssigneeIds = selectedAssigneeIds.filter((assigneeId) =>
      assignees.some((assignee) => assignee.id === assigneeId)
    );
    if (validAssigneeIds.length !== selectedAssigneeIds.length) {
      setSelectedAssigneeIds(validAssigneeIds);
    }
  }, [assignees, filterOptionsLoaded, selectedAssigneeIds]);

  useEffect(() => {
    if (!filterOptionsLoaded) {
      return;
    }
    const validStatuses = selectedStatuses.filter((status) => statuses.includes(status));
    if (validStatuses.length !== selectedStatuses.length) {
      setSelectedStatuses(validStatuses);
    }
  }, [filterOptionsLoaded, selectedStatuses, statuses]);

  useEffect(() => {
    if (!filterOptionsLoaded) {
      return;
    }
    if (workspaces.length <= 1 && selectedWorkspaceId) {
      setSelectedWorkspaceId("");
      return;
    }

    if (selectedWorkspaceId && !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId("");
    }
  }, [filterOptionsLoaded, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!filterOptionsLoaded) {
      return;
    }
    if (selectedCycleId && !cycles.some((cycle) => cycle.id === selectedCycleId)) {
      setSelectedCycleId("");
    }
  }, [cycles, filterOptionsLoaded, selectedCycleId]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      statuses:
        selectedStatuses.length > 0 && selectedStatuses.length < statuses.length
          ? selectedStatuses
          : undefined,
      assigneeIds: selectedAssigneeIds.length > 0 ? selectedAssigneeIds : undefined,
      teamId: selectedWorkspaceId || undefined,
      cycleId: selectedCycleId || undefined,
      sortBy,
      sortDir,
      hasActivity: hasActivity || undefined,
    }),
    [debouncedSearch, selectedAssigneeIds, selectedCycleId, selectedStatuses, selectedWorkspaceId, statuses.length, sortBy, sortDir, hasActivity]
  );

  const {
    issues,
    loading: issuesLoading,
    hasMore,
    loadMore,
    refresh: refreshIssues,
    updateIssue,
  } = useLinearIssues(filters, connected, { projectSlug });
  const selectedIssueFromList = useMemo(
    () => (selectedIssueId ? issues.find((issue) => issue.id === selectedIssueId) ?? null : null),
    [issues, selectedIssueId],
  );
  const selectedIssue =
    selectedIssueFromList ??
    (selectedIssueFallback?.id === selectedIssueId ? selectedIssueFallback : null);
  const {
    runs,
    loading: runsLoading,
    createRun,
    updateRun,
  } = useLinearRuns(selectedIssue?.id, projectId ?? null);
  const {
    scripts: runScripts,
    activeScriptId,
    activeScript,
    setActiveScriptId,
    saveScript,
    deleteScript,
  } = useLinearRunScripts(projectSlug);

  const selectedRun =
    selectedRunId && selectedRunId !== NEW_SESSION_PANEL_ID
      ? runs.find((run) => run.id === selectedRunId) ?? null
      : null;
  const assigneeOptions = useMemo<FilterOption[]>(
    () => assignees.map((assignee) => ({ value: assignee.id, label: assignee.name })),
    [assignees]
  );
  const statusOptions = useMemo<FilterOption[]>(
    () => statuses.map((status) => ({ value: status, label: status })),
    [statuses]
  );
  const issueStatusOptions = useMemo<FilterOption[]>(
    () =>
      Array.from(
        new Set(
          [selectedIssue?.status ?? "", ...statuses]
            .map((status) => status.trim())
            .filter(Boolean)
        )
      ).map((status) => ({ value: status, label: status })),
    [selectedIssue?.status, statuses]
  );
  const workspaceOptions = useMemo<FilterOption[]>(
    () => [{ value: "", label: "Workspace" }, ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))],
    [workspaces]
  );
  const cycleOptions = useMemo<FilterOption[]>(
    () => [
      { value: "", label: "Cycle" },
      ...cycles.map((cycle) => ({
        value: cycle.id,
        label: cycle.name || `Cycle ${cycle.number}`,
      })),
    ],
    [cycles]
  );
  const showStatusFilter = statusOptions.length > 0;
  const showCycleFilter = cycleOptions.length > 1;
  const showWorkspaceFilter = workspaceOptions.length > 2;
  const activeSessionScriptLabel = activeScript?.name ?? "AGX default";

  const handleIssueStatusChange = useCallback(
    async (issue: LinearIssue, status: string) => {
      const nextStatus = status.trim();
      if (!nextStatus || nextStatus === issue.status) {
        return;
      }

      setUpdatingIssueId(issue.id);
      try {
        const response = await fetch(`/api/linear/issues/${encodeURIComponent(issue.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          issue?: LinearIssue;
        };

        if (!response.ok || !payload.issue) {
          throw new Error(payload.error || "Failed to update ticket status");
        }

        const updatedIssue = payload.issue;
        updateIssue(updatedIssue);
        if (selectedIssueId === updatedIssue.id) {
          setSelectedIssueFallback(updatedIssue);
        }
        await refreshIssues();
      } catch (error) {
        if (error instanceof Error) {
          window.alert(error.message);
        }
      } finally {
        setUpdatingIssueId((current) => (current === issue.id ? null : current));
      }
    },
    [refreshIssues, selectedIssueId, updateIssue]
  );

  useEffect(() => {
    if (!selectedIssueId) {
      setSelectedIssueFallback(null);
      return;
    }

    if (selectedIssueFromList) {
      setSelectedIssueFallback((current) => {
        if (current?.id === selectedIssueId) {
          return selectedIssueFromList;
        }
        return null;
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/linear/issues/${encodeURIComponent(selectedIssueId)}`);
        if (cancelled) return;

        if (response.status === 404) {
          replaceSelection({ issue: null, run: null });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch selected Linear ticket: ${response.status}`);
        }

        const payload = (await response.json().catch(() => ({}))) as { issue?: LinearIssue };
        if (!payload.issue?.id) {
          replaceSelection({ issue: null, run: null });
          return;
        }

        setSelectedIssueFallback(payload.issue);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to hydrate selected Linear issue", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceSelection, selectedIssueFromList, selectedIssueId]);

  useEffect(() => {
    if (!selectedIssueId) {
      if (selectedRunId) {
        replaceSelection({ run: null });
      }
      return;
    }
  }, [replaceSelection, selectedIssueId, selectedRunId]);

  useEffect(() => {
    if (!selectedIssue || !selectedRunId || selectedRunId === NEW_SESSION_PANEL_ID || runsLoading) {
      return;
    }

    if (!runs.some((run) => run.id === selectedRunId)) {
      replaceSelection({ run: null });
    }
  }, [replaceSelection, runs, runsLoading, selectedIssue, selectedRunId]);

  useEffect(() => {
    let cancelled = false;

    async function loadParticipants() {
      try {
        const participantsResponse = await fetch("/api/participants");
        const allParticipants = participantsResponse.ok
          ? ((await participantsResponse.json()) as Participant[])
          : [];

        if (!projectId) {
          if (!cancelled) setParticipants(allParticipants);
          return;
        }

        const projectAgentsResponse = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/agents`
        );
        if (!projectAgentsResponse.ok) {
          if (!cancelled) setParticipants(allParticipants);
          return;
        }

        const projectData = await projectAgentsResponse.json();
        const orderedAgentIds: string[] = Array.isArray(projectData.agents)
          ? projectData.agents
              .map((agent: { agent_id?: string }) => agent.agent_id)
              .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const orderIndex = new Map(orderedAgentIds.map((id, index) => [id, index]));
        const scopedParticipants = allParticipants
          .filter((participant) => orderIndex.has(participant.id))
          .sort(
            (left, right) =>
              (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
          );

        if (!cancelled) {
          setParticipants(scopedParticipants);
        }
      } catch {
        if (!cancelled) {
          setParticipants([]);
        }
      }
    }

    void loadParticipants();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    async function fetchActiveAgents() {
      try {
        const params = new URLSearchParams();
        if (projectId) params.set("projectId", projectId);
        const res = await fetch(`/api/linear/issues/active-agents?${params}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const map = new Map<string, Array<{ agentId: string; agentName: string }>>();
        for (const entry of data.agents ?? []) {
          const list = map.get(entry.issueId) ?? [];
          list.push({ agentId: entry.agentId, agentName: entry.agentName });
          map.set(entry.issueId, list);
        }
        if (!cancelled) setIssueActiveAgents(map);
      } catch {
        // ignore
      }
    }

    void fetchActiveAgents();
    const interval = setInterval(() => void fetchActiveAgents(), 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId]);

  useEffect(() => {
    if (!showRunScripts) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (runScriptsPanelRef.current?.contains(target)) {
        return;
      }
      if (runScriptsButtonRef.current?.contains(target)) {
        return;
      }
      setShowRunScripts(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRunScripts(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showRunScripts]);

  const executeWithAgent = useCallback(
    async (issue: LinearIssue, agent: Participant) => {
      setPickerIssue(null);
      setPickerAnchor(null);

      try {
        const response = await fetch("/api/linear/runs/scripted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectId ?? undefined,
            projectSlug: projectSlug ?? undefined,
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            issueTitle: issue.title,
            issueStatus: issue.status,
            issueAssignee: issue.assignee,
            agentId: agent.id,
            scriptName: activeScript?.name,
            scriptPrompt: activeScript?.prompt,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          run?: LinearRun;
          chatRunId?: string;
          userMessageId?: string;
        };

        if (!response.ok || !payload.run || !payload.chatRunId || !payload.userMessageId) {
          throw new Error(payload.error || "Failed to start scripted session");
        }
        pushSelection({
          issue: issue.id,
          run: payload.run.id,
        });
      } catch (error) {
        console.error("Failed to start scripted Linear session:", error);
        if (error instanceof Error) {
          window.alert(error.message);
        }
      }
    },
    [activeScript, projectId, projectSlug, pushSelection]
  );

  const handleStartScriptedSession = useCallback(
    (issue: LinearIssue, event?: React.MouseEvent) => {
      setShowRunScripts(false);
      if (participants.length === 0) {
        window.alert("Add at least one agent to this project before starting a scripted session.");
        return;
      }
      if (participants.length === 1) {
        void executeWithAgent(issue, participants[0]);
        return;
      }
      // Multiple agents — show picker
      const rect = (event?.currentTarget as HTMLElement)?.getBoundingClientRect();
      setPickerIssue(issue);
      setPickerAnchor(rect ? { top: rect.bottom + 4, left: rect.left } : { top: 200, left: 200 });
    },
    [executeWithAgent, participants],
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  if (connectionLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
        Loading...
      </div>
    );
  }

  const needsMcpSetup = connected && !setupDismissed && !Object.values(mcpConfigured).some(Boolean);

  if (!connected || needsMcpSetup) {
    return (
      <LinearSetup
        connected={connected}
        user={user}
        clis={clis}
        mcpConfigured={mcpConfigured}
        onConnect={connect}
        onConnectWithKey={connectWithKey}
        onDisconnect={disconnect}
        onConfigureMcp={configureMcp}
        onContinue={() => setSetupDismissed(true)}
      />
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="flex shrink-0 flex-col border-r border-[var(--card-border)]" style={{ width: ticketPanelWidth }}>
        <div className="shrink-0 border-b border-[var(--card-border)]">
          <div className="flex h-12 items-center gap-2 px-3">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--card-border)] bg-[var(--background)] px-2.5 py-1.5 transition-all focus-within:border-[var(--muted-foreground)] focus-within:ring-1 focus-within:ring-[var(--muted-foreground)]">
              <Search size={14} className="shrink-0 text-[var(--muted-foreground)]" />
              <input
                type="text"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                placeholder="Search tickets..."
                value={search}
                onChange={(event) => handleSearchChange(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void refreshIssues()}
              title="Refresh tickets"
              aria-label="Refresh tickets"
              disabled={issuesLoading}
            >
              <RefreshCw size={16} className={issuesLoading ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
              onClick={() => {
                setShowRunScripts(false);
                setShowSettings(true);
              }}
              title="Linear settings"
            >
              <Settings size={16} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2">
            {showStatusFilter ? (
              <MultiFilterPopdown
                label="Status"
                values={selectedStatuses}
                options={statusOptions}
                activeClasses="border-amber-500/30 bg-amber-500/10 text-amber-300"
                onChange={setSelectedStatuses}
                emptyLabel="All statuses"
              />
            ) : null}
            <MultiFilterPopdown
              label="Assignee"
              values={selectedAssigneeIds}
              options={assigneeOptions}
              activeClasses="border-blue-500/30 bg-blue-500/10 text-blue-400"
              onChange={setSelectedAssigneeIds}
              emptyLabel="All assignees"
            />
            {showWorkspaceFilter ? (
              <FilterSelect
                label="Workspace"
                value={selectedWorkspaceId}
                options={workspaceOptions}
                activeClasses="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                onChange={setSelectedWorkspaceId}
              />
            ) : null}
            {showCycleFilter ? (
              <FilterSelect
                label="Cycle"
                value={selectedCycleId}
                options={cycleOptions}
                activeClasses="border-purple-500/30 bg-purple-500/10 text-purple-400"
                onChange={setSelectedCycleId}
              />
            ) : null}
            <FilterSelect
              label="Sort"
              value={sortBy}
              options={[
                { value: "activity", label: "Activity" },
                { value: "identifier", label: "Ticket ID" },
                { value: "status", label: "Status" },
                { value: "created", label: "Created" },
              ]}
              activeClasses="border-sky-500/30 bg-sky-500/10 text-sky-400"
              onChange={(value) => setSortBy(value as typeof sortBy)}
            />
            <button
              type="button"
              className="rounded-full border border-[var(--card-border)] p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
              title={sortDir === "desc" ? "Descending" : "Ascending"}
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              {sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                hasActivity
                  ? "border-orange-500/30 bg-orange-500/10 text-orange-400"
                  : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
              }`}
              onClick={() => setHasActivity((v) => !v)}
            >
              My activity
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {issuesLoading && issues.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
              Loading tickets...
            </div>
          ) : issues.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
              No tickets found.
            </div>
          ) : (
            <>
              {issues.map((issue) => (
                <TicketRow
                  key={issue.id}
                  issue={issue}
                  selected={selectedIssue?.id === issue.id}
                  activeAgents={issueActiveAgents.get(issue.id)}
                  participants={participants}
                  onSelect={() =>
                    pushSelection({
                      issue: issue.id,
                      run: null,
                    })
                  }
                />
              ))}
              {hasMore ? (
                <div
                  ref={sentinelRef}
                  className="py-2 text-center text-xs text-[var(--muted-foreground)]"
                >
                  {issuesLoading ? "Loading..." : "Load more"}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ResizeHandle onResize={(delta) => setTicketPanelWidth((w) => { const next = Math.max(180, Math.min(600, w + delta)); persistLinearTicketPanelWidth(next); return next; })} />

      <div className="flex shrink-0 flex-col border-r border-[var(--card-border)]" style={{ width: runsPanelWidth }}>
        <div className="relative flex items-center justify-between border-b border-[var(--card-border)] px-3 py-2">
          <h3 className="text-xs font-semibold text-[var(--foreground)]">Sessions</h3>
          <button
            ref={runScriptsButtonRef}
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              setShowRunScripts(false);
              pushSelection({ run: NEW_SESSION_PANEL_ID });
            }}
            title="Open a fresh chat for this ticket. You can choose or edit the session script in the session details pane."
            aria-label="New session"
            disabled={!selectedIssue}
          >
            <Plus size={12} />
            New session
          </button>
          {showRunScripts ? (
            <div
              ref={runScriptsPanelRef}
              className="absolute right-3 top-full z-20 mt-2 max-h-[80vh] overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--background)] p-4 shadow-2xl"
              style={{ width: "min(760px, calc(100vw - 32px))" }}
            >
              <RunScriptManager
                projectSlug={projectSlug}
                scripts={runScripts}
                activeScriptId={activeScriptId}
                onSetActiveScriptId={setActiveScriptId}
                onSaveScript={saveScript}
                onDeleteScript={deleteScript}
              />
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedIssue ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
              Select a ticket to see sessions.
            </div>
          ) : (
            <>
              {runsLoading && runs.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  Loading sessions...
                </div>
              ) : runs.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  No previous sessions yet.
                </div>
              ) : (
                runs.map((run) => {
                  const runDisplay = getRunDisplayState(run);

                  return (
                    <button
                      key={run.id}
                      type="button"
                      className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                        selectedRun?.id === run.id
                          ? "bg-[var(--card-bg)]"
                          : "hover:bg-[var(--card-bg)]"
                      }`}
                      onClick={() => pushSelection({ run: run.id })}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--foreground)]">
                          {getRunTitle(run)}
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {formatRunTime(run.startedAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                        <span className={`font-medium ${STATUS_TEXT_COLORS[runDisplay.tone]}`}>
                          {runDisplay.label}
                        </span>
                        <span className="truncate text-[var(--muted-foreground)]">
                          {run.agentName}
                        </span>
                      </div>
                      {run.durationMs != null ? (
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          {(run.durationMs / 1000).toFixed(1)}s
                        </div>
                      ) : null}
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      <ResizeHandle onResize={(delta) => setRunsPanelWidth((w) => { const next = Math.max(140, Math.min(500, w + delta)); persistLinearRunsPanelWidth(next); return next; })} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedRun ? (
          <ThreadMessageList
            issue={selectedIssue ?? {
              id: selectedRun.issueId,
              identifier: selectedRun.issueIdentifier,
              title: selectedRun.issueTitle,
              url: null,
              status: selectedRun.issueStatus,
              assignee: selectedRun.issueAssignee,
              updatedAt: selectedRun.updatedAt,
            }}
            run={selectedRun}
            participants={participants}
            issueStatusOptions={issueStatusOptions}
            issueStatusUpdating={updatingIssueId === selectedRun.issueId}
            onIssueStatusChange={handleIssueStatusChange}
          />
        ) : !selectedIssue ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Select a ticket from the list.
          </div>
        ) : participants.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Add at least one agent to this project to start a session.
          </div>
        ) : selectedRunId === NEW_SESSION_PANEL_ID || runs.length === 0 ? (
          <TicketChatStarter
            key={selectedIssue.id}
            issue={selectedIssue}
            participants={participants}
            projectId={projectId}
            projectSlug={projectSlug}
            issueStatusOptions={issueStatusOptions}
            issueStatusUpdating={updatingIssueId === selectedIssue.id}
            onIssueStatusChange={handleIssueStatusChange}
            activeSessionScriptLabel={activeSessionScriptLabel}
            onOpenSessionScripts={() => setShowRunScripts(true)}
            onStartScriptedSession={(event) => handleStartScriptedSession(selectedIssue, event)}
            createRun={createRun}
            updateRun={updateRun}
            onRunCreated={(runId) => pushSelection({ run: runId })}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            {runsLoading ? "Loading sessions..." : "Select a session to continue."}
          </div>
        )}
      </div>

      {/* Settings overlay */}
      {showSettings && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="relative w-full max-w-lg rounded-lg border border-[var(--card-border)] bg-[var(--background)] shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-3 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
              onClick={() => setShowSettings(false)}
            >
              &times;
            </button>
            <div className="max-h-[80vh] overflow-y-auto p-6">
              <LinearSetup
                connected={connected}
                user={user}
                clis={clis}
                mcpConfigured={mcpConfigured}
                onConnect={connect}
                onConnectWithKey={connectWithKey}
                onDisconnect={disconnect}
                onConfigureMcp={configureMcp}
                onContinue={() => setShowSettings(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Agent picker popover */}
      {pickerIssue && pickerAnchor && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setPickerIssue(null);
              setPickerAnchor(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[180px] rounded border border-[var(--card-border)] bg-[var(--card-bg)] py-1 shadow-lg"
            style={{ top: pickerAnchor.top, left: pickerAnchor.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Pick an agent
            </div>
            {participants.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--card-bg)]"
                onClick={() => void executeWithAgent(pickerIssue, agent)}
              >
                <img
                  src={agentAvatarUrl(agent.id, agent.color, 20)}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full"
                />
                <span className="flex flex-col">
                  <span className="font-medium text-[var(--foreground)]">{agent.name}</span>
                  {agent.title ? (
                    <span className="text-[10px] text-[var(--muted-foreground)]">{agent.title}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

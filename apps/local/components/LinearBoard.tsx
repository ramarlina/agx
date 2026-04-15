"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, ChevronLeft, Clock, FileText, Play, Plus, RefreshCw, Search, Settings, User, X } from "lucide-react";
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
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import {
  loadLinearBoardFilters,
  persistLinearBoardFilters,
} from "@/state/linearBoardFilters";
import {
  loadPinnedIssueIds,
  persistPinnedIssueIds,
} from "@/state/linearBoardPins";
import {
  loadLinearTicketPanelWidth,
  persistLinearTicketPanelWidth,
} from "@/state/windowState";
import {
  orderParticipantIds,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import { buildLinearExecutionPrompt } from "@/lib/linear-execution-prompt";
import type { Participant } from "@/lib/types";
import LinearSetup from "@/components/LinearSetup";
import LinearSettingsModal from "@/components/linear/LinearSettingsModal";
import {
  getRunDisplayState,
  getRunTitle,
  STATUS_BADGE_STYLES,
  STATUS_DOT_COLORS,
  STATUS_TEXT_COLORS,
} from "@/lib/linear-run-status";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
  FilterSelect,
  IssueStatusSelect,
  MultiFilterPopdown,
  type FilterOption,
} from "@/components/linear/LinearBoardFilters";
import { TicketRow } from "@/components/linear/TicketRow";
import { TicketPanel } from "@/components/linear/TicketPanel";
import { useLinearParticipants } from "@/hooks/useLinearParticipants";
import { useLinearActiveAgents } from "@/hooks/useLinearActiveAgents";
import { agentAvatarUrl } from "@/lib/linear-board-utils";

const Composer = dynamic(
  () => import("@/components/chat-ui/Composer").then((module) => module.Composer),
  { ssr: false }
);

function createThreadId() {
  return globalThis.crypto?.randomUUID?.() ?? `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

function ThreadMessageList({
  issue,
  run,
  participants,
  issueStatusOptions,
  issueStatusUpdating,
  onIssueStatusChange,
  onBack,
}: {
  issue: LinearIssue;
  run: LinearRun;
  participants: Participant[];
  issueStatusOptions: FilterOption[];
  issueStatusUpdating: boolean;
  onIssueStatusChange: (issue: LinearIssue, status: string) => void;
  onBack?: () => void;
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
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
              title="Back to sessions"
            >
              <ChevronLeft size={16} />
            </button>
          )}
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

interface LinearBoardProps {
  projectId?: string;
  projectSlug?: string;
  initialShowSettings?: boolean;
}

export default function LinearBoard({ projectId, projectSlug, initialShowSettings }: LinearBoardProps) {
  const { isTouchLayout } = useInputCapabilities();
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
  const [pinnedIssueIds, setPinnedIssueIds] = useState<Set<string>>(() => loadPinnedIssueIds(projectSlug));
  const [selectedIssueFallback, setSelectedIssueFallback] = useState<LinearIssue | null>(null);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const { participants } = useLinearParticipants(projectId);
  const { issueActiveAgents } = useLinearActiveAgents(projectId);
  const [pickerIssue, setPickerIssue] = useState<LinearIssue | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [touchPanelTab, setTouchPanelTab] = useState<"runs" | "ticket">("runs");
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

  const togglePin = useCallback((issueId: string) => {
    setPinnedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      persistPinnedIssueIds(projectSlug, next);
      return next;
    });
  }, [projectSlug]);

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
    setPinnedIssueIds(loadPinnedIssueIds(projectSlug));
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
    const query = params.toString();
    const url = query ? `/api/linear/options?${query}` : "/api/linear/options";
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
  } = useLinearIssues(filters, connected && filterOptionsLoaded, { projectSlug });
  const selectedIssueFromList = useMemo(
    () => (selectedIssueId ? issues.find((issue) => issue.id === selectedIssueId) ?? null : null),
    [issues, selectedIssueId],
  );
  const selectedIssue =
    selectedIssueFromList ??
    (selectedIssueFallback?.id === selectedIssueId ? selectedIssueFallback : null);

  const sortedIssues = useMemo(() => {
    if (pinnedIssueIds.size === 0) return issues;
    const pinned: LinearIssue[] = [];
    const unpinned: LinearIssue[] = [];
    for (const issue of issues) {
      if (pinnedIssueIds.has(issue.id)) {
        pinned.push(issue);
      } else {
        unpinned.push(issue);
      }
    }
    return [...pinned, ...unpinned];
  }, [issues, pinnedIssueIds]);

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

  const selectedRun = selectedRunId
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
    if (!selectedIssue || !selectedRunId || runsLoading) {
      return;
    }

    if (!runs.some((run) => run.id === selectedRunId)) {
      replaceSelection({ run: null });
    }
  }, [replaceSelection, runs, runsLoading, selectedIssue, selectedRunId]);

  useEffect(() => {
    if (!isTouchLayout) {
      return;
    }

    if (!selectedIssue) {
      setTouchPanelTab("runs");
      return;
    }

    if (selectedRun || runs.length === 0) {
      setTouchPanelTab("ticket");
      return;
    }

    setTouchPanelTab("runs");
  }, [isTouchLayout, runs.length, selectedIssue, selectedRun]);

  useEffect(() => {
    if (!showRunScripts) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
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

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
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
      {isTouchLayout ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
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
                  className="shrink-0 rounded p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void refreshIssues()}
                  title="Refresh tickets"
                  aria-label="Refresh tickets"
                  disabled={issuesLoading}
                >
                  <RefreshCw size={16} className={issuesLoading ? "animate-spin" : undefined} />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  onClick={() => {
                    setShowRunScripts(false);
                    setShowSettings(true);
                  }}
                  title="Linear settings"
                >
                  <Settings size={16} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
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
                  className="rounded-full border border-[var(--card-border)] p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  title={sortDir === "desc" ? "Descending" : "Ascending"}
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                >
                  {sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
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
                  {sortedIssues.map((issue, idx) => (
                    <React.Fragment key={issue.id}>
                      {pinnedIssueIds.size > 0 &&
                        !pinnedIssueIds.has(issue.id) &&
                        (idx === 0 || pinnedIssueIds.has(sortedIssues[idx - 1].id)) && (
                          <div className="mx-4 border-t border-amber-500/20" />
                        )}
                      <TicketRow
                        issue={issue}
                        selected={selectedIssue?.id === issue.id}
                        pinned={pinnedIssueIds.has(issue.id)}
                        activeAgents={issueActiveAgents.get(issue.id)}
                        participants={participants}
                        onSelect={() => {
                          setTouchPanelTab("runs");
                          pushSelection({
                            issue: issue.id,
                            run: null,
                          });
                        }}
                        onTogglePin={() => togglePin(issue.id)}
                      />
                    </React.Fragment>
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

          {selectedIssue ? (
            <div className="absolute inset-0 z-20 flex flex-col bg-[var(--background)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                    {selectedIssue.identifier}
                  </div>
                  <div className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {selectedIssue.title}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  onClick={() => replaceSelection({ issue: null, run: null })}
                  aria-label="Close ticket panel"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-center gap-2 border-b border-[var(--card-border)] px-3 py-2">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    touchPanelTab === "runs"
                      ? "bg-[var(--card-bg)] text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setTouchPanelTab("runs")}
                >
                  Runs
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    touchPanelTab === "ticket"
                      ? "bg-[var(--card-bg)] text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setTouchPanelTab("ticket")}
                >
                  Ticket
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {touchPanelTab === "runs" ? (
                  <div className="flex h-full flex-col overflow-hidden">
                    <div className="relative flex items-center justify-between border-b border-[var(--card-border)] px-3 py-2">
                      <h3 className="text-xs font-semibold text-[var(--foreground)]">Sessions</h3>
                      <button
                        ref={runScriptsButtonRef}
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => {
                          setShowRunScripts(false);
                          setTouchPanelTab("ticket");
                          pushSelection({ run: null });
                        }}
                        title="Open a fresh chat for this ticket. You can choose or edit the session script in the ticket tab."
                        aria-label="New session"
                        disabled={!selectedIssue}
                      >
                        <Plus size={12} />
                        New session
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
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
                              onClick={() => {
                                setTouchPanelTab("ticket");
                                pushSelection({ run: run.id });
                              }}
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
                    </div>
                  </div>
                ) : selectedRun ? (
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
                    onBack={() => replaceSelection({ run: null })}
                  />
                ) : participants.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
                    Add at least one agent to this project to start a session.
                  </div>
                ) : (
                  <TicketPanel
                    key={selectedIssue.id}
                    issue={selectedIssue}
                    runs={runs}
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
                    onSelectRun={(runId) => pushSelection({ run: runId })}
                  />
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
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
              {sortedIssues.map((issue, idx) => (
                <React.Fragment key={issue.id}>
                  {pinnedIssueIds.size > 0 &&
                    !pinnedIssueIds.has(issue.id) &&
                    (idx === 0 || pinnedIssueIds.has(sortedIssues[idx - 1].id)) && (
                      <div className="mx-4 border-t border-amber-500/20" />
                    )}
                  <TicketRow
                    issue={issue}
                    selected={selectedIssue?.id === issue.id}
                    pinned={pinnedIssueIds.has(issue.id)}
                    activeAgents={issueActiveAgents.get(issue.id)}
                    participants={participants}
                    onSelect={() =>
                      pushSelection({
                        issue: issue.id,
                        run: null,
                      })
                    }
                    onTogglePin={() => togglePin(issue.id)}
                  />
                </React.Fragment>
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

      {showRunScripts ? (
        <div
          ref={runScriptsPanelRef}
          className="absolute right-6 top-16 z-20 max-h-[80vh] overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--background)] p-4 shadow-2xl"
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
            onBack={() => replaceSelection({ run: null })}
          />
        ) : !selectedIssue ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Select a ticket from the list.
          </div>
        ) : participants.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Add at least one agent to this project to start a session.
          </div>
        ) : (
          <TicketPanel
            key={selectedIssue.id}
            issue={selectedIssue}
            runs={runs}
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
            onSelectRun={(runId) => pushSelection({ run: runId })}
          />
        )}
      </div>
        </>
      )}

      {/* Settings overlay */}
      {showSettings && (
        <LinearSettingsModal
          connected={connected}
          user={user}
          clis={clis}
          mcpConfigured={mcpConfigured}
          onConnect={connect}
          onConnectWithKey={connectWithKey}
          onDisconnect={disconnect}
          onConfigureMcp={configureMcp}
          onClose={() => setShowSettings(false)}
          projectId={projectId}
        />
      )}

      {showRunScripts && isTouchLayout ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div
            ref={runScriptsPanelRef}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--background)] p-4 shadow-2xl"
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
        </div>
      ) : null}

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
                  {agent.role ? (
                    <span className="text-[10px] text-[var(--muted-foreground)]">{agent.role}</span>
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

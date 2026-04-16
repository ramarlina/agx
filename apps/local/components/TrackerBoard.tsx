"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, ChevronLeft, Clock, FileText, Play, Plus, RefreshCw, Search, Settings, User, X } from "lucide-react";
import { useUrlSelection } from "@/hooks/useUrlSelection";
import { useTrackerItems } from "@/hooks/useTrackerItems";
import type { TrackerItem, TrackerStatusCategory } from "@/lib/tracker/types";
import { useTrackerConnection } from "@/hooks/useTrackerConnection";
import { useTrackerRuns } from "@/hooks/useTrackerRuns";
import type { TrackerRunRecord } from "@/lib/tracker/tracker-run-store";
import { useTrackerRunScripts } from "@/hooks/useTrackerRunScripts";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { Markdown } from "@/components/chat-ui/Markdown";
import RunScriptManager from "@/components/tracker/RunScriptManager";
import { stripMarkers } from "@/lib/chat-utils";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import {
  loadTrackerBoardFilters,
  persistTrackerBoardFilters,
} from "@/state/trackerBoardFilters";
import {
  loadPinnedTrackerItemIds,
  persistPinnedTrackerItemIds,
} from "@/state/trackerBoardPins";
import {
  loadLinearTicketPanelWidth,
  persistLinearTicketPanelWidth,
} from "@/state/windowState";
import {
  orderParticipantIds,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import { buildTrackerExecutionPrompt } from "@/lib/tracker/tracker-execution-prompt";
import type { Participant } from "@/lib/types";
import LinearSetup from "@/components/LinearSetup";
import TrackerSettingsModal from "@/components/tracker/TrackerSettingsModal";
import {
  getRunDisplayState,
  getRunTitle,
  STATUS_BADGE_STYLES,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  STATUS_TEXT_COLORS,
} from "@/lib/tracker-run-status";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
  FilterSelect,
  IssueStatusSelect,
  MultiFilterPopdown,
  type FilterOption,
} from "@/components/tracker/TrackerBoardFilters";
import { TicketRow } from "@/components/tracker/TicketRow";
import { TicketPanel } from "@/components/tracker/TicketPanel";
import { useTrackerParticipants } from "@/hooks/useTrackerParticipants";
import { useTrackerActiveAgents } from "@/hooks/useTrackerActiveAgents";
import { agentAvatarUrl } from "@/lib/tracker-board-utils";
import { useTaskGroups, type TaskGroup } from "@/hooks/useTaskGroups";
import { FolderRow } from "@/components/tracker/FolderRow";
import { GroupPanel } from "@/components/tracker/GroupPanel";
import { GroupNamePrompt, PENDING_GROUP_DROP_ID } from "@/components/tracker/GroupNamePrompt";
import { SelectionBar } from "@/components/tracker/SelectionBar";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

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

interface GroupOption {
  id: string;
  name: string;
}

interface TrackerEntityOption {
  id: string;
  name: string;
}

function ThreadMessageList({
  item,
  run,
  participants,
  itemStatusOptions,
  itemStatusUpdating,
  onItemStatusChange,
  onBack,
}: {
  item: TrackerItem;
  run: TrackerRunRecord;
  participants: Participant[];
  itemStatusOptions: FilterOption[];
  itemStatusUpdating: boolean;
  onItemStatusChange: (item: TrackerItem, status: string) => void;
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
    const mappedStatus: Record<string, TrackerRunRecord["status"]> = {
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
            {item.identifier}
          </span>
          <div className="h-1 w-1 shrink-0 rounded-full bg-[var(--card-border)]" />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {getRunTitle(run)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <IssueStatusSelect
            status={item.status}
            options={itemStatusOptions}
            disabled={itemStatusOptions.length === 0}
            updating={itemStatusUpdating}
            onChange={(status) => onItemStatusChange(item, status)}
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
            projectId={run.projectId ?? undefined}
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

interface TrackerBoardProps {
  trackerType: string;
  projectId?: string;
  projectSlug?: string;
  initialShowSettings?: boolean;
}

export default function TrackerBoard({ trackerType, projectId, projectSlug, initialShowSettings }: TrackerBoardProps) {
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
  } = useTrackerConnection(trackerType, projectId ?? "");

  const [setupDismissed, setSetupDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(initialShowSettings ?? false);
  const [showRunScripts, setShowRunScripts] = useState(false);
  const [ticketPanelWidth, setTicketPanelWidth] = useState(() => loadLinearTicketPanelWidth() || 576);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);
  const [assignees, setAssignees] = useState<TrackerEntityOption[]>([]);
  const [statusCategories, setStatusCategories] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<TrackerEntityOption[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedStatusCategories, setSelectedStatusCategories] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [sortBy, setSortBy] = useState<"activity" | "identifier" | "status" | "created">("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hasActivity, setHasActivity] = useState(false);
  const [pinnedItemIds, setPinnedItemIds] = useState<Set<string>>(() => loadPinnedTrackerItemIds(trackerType, projectSlug));
  const [selectedItemFallback, setSelectedItemFallback] = useState<TrackerItem | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const { participants } = useTrackerParticipants(trackerType, projectId);
  const { issueActiveAgents } = useTrackerActiveAgents(trackerType, projectId);
  const [pickerItem, setPickerItem] = useState<TrackerItem | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [touchPanelTab, setTouchPanelTab] = useState<"runs" | "ticket">("runs");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFilterPersistRef = useRef(true);
  const runScriptsButtonRef = useRef<HTMLButtonElement | null>(null);
  const runScriptsPanelRef = useRef<HTMLDivElement | null>(null);
  const { getSelection, pushSelection, replaceSelection } = useUrlSelection();
  const selectedItemId = getSelection("issue");
  const selectedRunId = getSelection("run");
  const selectedGroupTaskGroupId = getSelection("group");

  // Task groups
  const {
    groups: taskGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addTasksToGroup,
    removeTaskFromGroup: removeTaskFromGroupApi,
    refetch: refetchGroups,
  } = useTaskGroups(projectId);

  // Multi-select state
  const [multiSelectedItemIds, setMultiSelectedItemIds] = useState<Set<string>>(new Set());
  const [showGroupNamePrompt, setShowGroupNamePrompt] = useState(false);
  const [pendingGroupTaskIds, setPendingGroupTaskIds] = useState<string[]>([]);
  const [pendingGroupTargetId, setPendingGroupTargetId] = useState<string | null>(null);

  // Drag state
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const toggleItemMultiSelect = useCallback((itemId: string) => {
    setMultiSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleCreateGroup = useCallback(
    async (name: string) => {
      if (pendingGroupTaskIds.length < 2) return;
      await createGroup(name, pendingGroupTaskIds);
      setPendingGroupTaskIds([]);
      setShowGroupNamePrompt(false);
      setPendingGroupTargetId(null);
      setMultiSelectedItemIds(new Set());
    },
    [pendingGroupTaskIds, createGroup],
  );

  const handleMultiSelectGroup = useCallback(() => {
    const ids = Array.from(multiSelectedItemIds);
    setPendingGroupTaskIds(ids);
    setShowGroupNamePrompt(true);
  }, [multiSelectedItemIds]);

  const selectedGroup = taskGroups.find((g) => g.id === selectedGroupTaskGroupId);
  const groupedItemIds = useMemo(
    () => new Set(taskGroups.flatMap((g) => g.task_ids)),
    [taskGroups],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDragActiveId(null);
      const { active, over } = event;

      const activeItemId = active.id as string;

      // While the pending group prompt is open, handle adds/removes
      if (showGroupNamePrompt) {
        const activeInPending = pendingGroupTaskIds.includes(activeItemId);

        if (!over || active.id === over.id) {
          // Dropped on nothing or self — if it was a pending item, remove it
          if (activeInPending) {
            setPendingGroupTaskIds((prev) => {
              const next = prev.filter((id) => id !== activeItemId);
              if (next.length < 2) {
                setShowGroupNamePrompt(false);
                setPendingGroupTargetId(null);
                return [];
              }
              return next;
            });
          }
          return;
        }

        const overId = over.id as string;
        const droppedOnPending = overId === PENDING_GROUP_DROP_ID || pendingGroupTaskIds.includes(overId);

        if (activeInPending && !droppedOnPending) {
          // Dragged out of pending group — remove it
          setPendingGroupTaskIds((prev) => {
            const next = prev.filter((id) => id !== activeItemId);
            if (next.length < 2) {
              setShowGroupNamePrompt(false);
              setPendingGroupTargetId(null);
              return [];
            }
            return next;
          });
        } else if (!activeInPending) {
          // Dragged into pending group — add it
          setPendingGroupTaskIds((prev) => [...prev, activeItemId]);
        }
        return;
      }

      if (!over || active.id === over.id) return;
      const overId = over.id as string;

      // Check if dropping on a folder
      const targetGroup = taskGroups.find((g) => g.id === overId);
      if (targetGroup) {
        await addTasksToGroup(targetGroup.id, [activeItemId]);
        return;
      }

      // Check if dropping on another loose ticket (create folder)
      const overIsLoose = !groupedItemIds.has(overId);
      const activeIsLoose = !groupedItemIds.has(activeItemId);
      if (activeIsLoose && overIsLoose) {
        setPendingGroupTaskIds([activeItemId, overId]);
        setPendingGroupTargetId(overId);
        setShowGroupNamePrompt(true);
        return;
      }

      // Ticket dragged out of a folder
      const activeGroup = taskGroups.find((g) => g.task_ids.includes(activeItemId));
      if (activeGroup && overIsLoose) {
        await removeTaskFromGroupApi(activeGroup.id, activeItemId);
      }
    },
    [taskGroups, groupedItemIds, addTasksToGroup, removeTaskFromGroupApi, showGroupNamePrompt, pendingGroupTaskIds],
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  const togglePin = useCallback((itemId: string) => {
    setPinnedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      persistPinnedTrackerItemIds(trackerType, projectSlug, next);
      return next;
    });
  }, [trackerType, projectSlug]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const storedFilters = loadTrackerBoardFilters(trackerType, projectSlug);
    skipNextFilterPersistRef.current = true;
    setSearch(storedFilters.search);
    setDebouncedSearch(storedFilters.search);
    setSelectedAssigneeIds(storedFilters.assigneeIds);
    setSelectedStatusCategories(storedFilters.statusCategories);
    setSelectedWorkspaceId(storedFilters.groupIds?.[0] ?? "");
    setSelectedGroupId(storedFilters.groupIds?.[0] ?? "");
    setSortBy(storedFilters.sortBy);
    setSortDir(storedFilters.sortDir);
    setHasActivity(storedFilters.hasActivity);
    setPinnedItemIds(loadPinnedTrackerItemIds(trackerType, projectSlug));
  }, [trackerType, projectSlug]);

  useEffect(() => {
    if (skipNextFilterPersistRef.current) {
      skipNextFilterPersistRef.current = false;
      return;
    }

    persistTrackerBoardFilters(trackerType, projectSlug, {
      search,
      assigneeIds: selectedAssigneeIds,
      statusCategories: selectedStatusCategories,
      groupIds: selectedGroupId ? [selectedGroupId] : [],
      sortBy,
      sortDir,
      hasActivity,
    });
  }, [trackerType, projectSlug, search, selectedAssigneeIds, selectedStatusCategories, selectedWorkspaceId, selectedGroupId, sortBy, sortDir, hasActivity]);

  // Fetch filter options when connected
  useEffect(() => {
    if (!connected || !projectId) return;
    let cancelled = false;
    setFilterOptionsLoaded(false);
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (projectSlug) {
      params.set("projectSlug", projectSlug);
    }
    const url = `/api/trackers/${trackerType}/options?${params.toString()}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        setAssignees(Array.isArray(data.assignees) ? data.assignees : []);
        setStatusCategories(Array.isArray(data.statuses) ? data.statuses.map((s: { name: string }) => s.name) : []);
        setWorkspaces(Array.isArray(data.teams) ? data.teams : []);
        setGroups(Array.isArray(data.cycles) ? data.cycles : []);
        setFilterOptionsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAssignees([]);
          setStatusCategories([]);
          setWorkspaces([]);
          setGroups([]);
          setFilterOptionsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connected, trackerType, projectId, projectSlug]);

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
    const validStatuses = selectedStatusCategories.filter((status) => statusCategories.includes(status));
    if (validStatuses.length !== selectedStatusCategories.length) {
      setSelectedStatusCategories(validStatuses);
    }
  }, [filterOptionsLoaded, selectedStatusCategories, statusCategories]);

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
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, filterOptionsLoaded, selectedGroupId]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      statusCategories:
        selectedStatusCategories.length > 0 && selectedStatusCategories.length < statusCategories.length
          ? selectedStatusCategories as TrackerStatusCategory[]
          : undefined,
      assigneeIds: selectedAssigneeIds.length > 0 ? selectedAssigneeIds : undefined,
      groupIds: selectedGroupId ? [selectedGroupId] : undefined,
      sortBy,
      sortDir,
      hasActivity: hasActivity || undefined,
    }),
    [debouncedSearch, selectedAssigneeIds, selectedGroupId, selectedStatusCategories, statusCategories.length, sortBy, sortDir, hasActivity]
  );

  const {
    items,
    loading: itemsLoading,
    hasMore,
    loadMore,
    refresh: refreshItems,
    updateItem,
  } = useTrackerItems(trackerType, filters, connected && filterOptionsLoaded && Boolean(projectId), {
    projectId: projectId ?? "",
  });
  const selectedItemFromList = useMemo(
    () => (selectedItemId ? items.find((item) => item.id === selectedItemId) ?? null : null),
    [items, selectedItemId],
  );
  const selectedItem =
    selectedItemFromList ??
    (selectedItemFallback?.id === selectedItemId ? selectedItemFallback : null);

  const sortedItems = useMemo(() => {
    if (pinnedItemIds.size === 0) return items;
    const pinned: TrackerItem[] = [];
    const unpinned: TrackerItem[] = [];
    for (const item of items) {
      if (pinnedItemIds.has(item.id)) {
        pinned.push(item);
      } else {
        unpinned.push(item);
      }
    }
    return [...pinned, ...unpinned];
  }, [items, pinnedItemIds]);

  const {
    runs,
    loading: runsLoading,
    createRun,
    updateRun,
  } = useTrackerRuns(trackerType, selectedItem?.id ?? null, projectId ?? null);
  const {
    scripts: runScripts,
    activeScriptId,
    activeScript,
    setActiveScriptId,
    saveScript,
    deleteScript,
  } = useTrackerRunScripts(trackerType, projectSlug);

  const selectedRun = selectedRunId
    ? runs.find((run) => run.id === selectedRunId) ?? null
    : null;
  const assigneeOptions = useMemo<FilterOption[]>(
    () => assignees.map((assignee) => ({ value: assignee.id, label: assignee.name })),
    [assignees]
  );
  const statusOptions = useMemo<FilterOption[]>(
    () => statusCategories.map((status) => ({ value: status, label: status })),
    [statusCategories]
  );
  const itemStatusOptions = useMemo<FilterOption[]>(
    () =>
      Array.from(
        new Set(
          [selectedItem?.status ?? "", ...statusCategories]
            .map((status) => status.trim())
            .filter(Boolean)
        )
      ).map((status) => ({ value: status, label: status })),
    [selectedItem?.status, statusCategories]
  );
  const workspaceOptions = useMemo<FilterOption[]>(
    () => [{ value: "", label: "Workspace" }, ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))],
    [workspaces]
  );
  const groupOptions = useMemo<FilterOption[]>(
    () => [
      { value: "", label: "Group" },
      ...groups.map((group) => ({
        value: group.id,
        label: group.name,
      })),
    ],
    [groups]
  );
  const showStatusFilter = statusOptions.length > 0;
  const showGroupFilter = groupOptions.length > 1;
  const showWorkspaceFilter = workspaceOptions.length > 2;
  const activeSessionScriptLabel = activeScript?.name ?? "AGX default";

  const handleItemStatusChange = useCallback(
    async (item: TrackerItem, status: string) => {
      const nextStatus = status.trim();
      if (!nextStatus || nextStatus === item.status) {
        return;
      }

      setUpdatingItemId(item.id);
      try {
        const response = await fetch(
          `/api/trackers/${trackerType}/items/${encodeURIComponent(item.id)}?projectId=${encodeURIComponent(projectId ?? "")}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          }
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          item?: TrackerItem;
        };

        if (!response.ok || !payload.item) {
          throw new Error(payload.error || "Failed to update ticket status");
        }

        const updatedItem = payload.item;
        updateItem(updatedItem);
        if (selectedItemId === updatedItem.id) {
          setSelectedItemFallback(updatedItem);
        }
        await refreshItems();
      } catch (error) {
        if (error instanceof Error) {
          window.alert(error.message);
        }
      } finally {
        setUpdatingItemId((current) => (current === item.id ? null : current));
      }
    },
    [refreshItems, selectedItemId, updateItem, trackerType]
  );

  useEffect(() => {
    if (!selectedItemId) {
      setSelectedItemFallback(null);
      return;
    }

    if (selectedItemFromList) {
      setSelectedItemFallback((current: TrackerItem | null) => {
        if (current?.id === selectedItemId) {
          return selectedItemFromList;
        }
        return null;
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/trackers/${trackerType}/items/${encodeURIComponent(selectedItemId)}`);
        if (cancelled) return;

        if (response.status === 404) {
          replaceSelection({ issue: null, run: null });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch selected tracker ticket: ${response.status}`);
        }

        const payload = (await response.json().catch(() => ({}))) as { item?: TrackerItem };
        if (!payload.item?.id) {
          replaceSelection({ issue: null, run: null });
          return;
        }

        setSelectedItemFallback(payload.item);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to hydrate selected tracker item", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceSelection, selectedItemFromList, selectedItemId, trackerType]);

  useEffect(() => {
    if (!selectedItemId) {
      if (selectedRunId) {
        replaceSelection({ run: null });
      }
      return;
    }
  }, [replaceSelection, selectedItemId, selectedRunId]);

  useEffect(() => {
    if (!selectedItem || !selectedRunId || runsLoading) {
      return;
    }

    if (!runs.some((run) => run.id === selectedRunId)) {
      replaceSelection({ run: null });
    }
  }, [replaceSelection, runs, runsLoading, selectedItem, selectedRunId]);

  useEffect(() => {
    if (!isTouchLayout) {
      return;
    }

    if (!selectedItem) {
      setTouchPanelTab("runs");
      return;
    }

    if (selectedRun || runs.length === 0) {
      setTouchPanelTab("ticket");
      return;
    }

    setTouchPanelTab("runs");
  }, [isTouchLayout, runs.length, selectedItem, selectedRun]);

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
    async (item: TrackerItem, agent: Participant) => {
      setPickerItem(null);
      setPickerAnchor(null);

      try {
        const response = await fetch(`/api/trackers/${trackerType}/runs/scripted`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectId ?? undefined,
            projectSlug: projectSlug ?? undefined,
            issueId: item.id,
            issueIdentifier: item.identifier,
            issueTitle: item.title,
            issueStatus: item.status,
            issueAssignee: item.assignee?.name ?? null,
            agentId: agent.id,
            scriptName: activeScript?.name,
            scriptPrompt: activeScript?.prompt,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          run?: TrackerRunRecord;
          chatRunId?: string;
          userMessageId?: string;
        };

        if (!response.ok || !payload.run || !payload.chatRunId || !payload.userMessageId) {
          throw new Error(payload.error || "Failed to start scripted session");
        }
        pushSelection({
          issue: item.id,
          run: payload.run.id,
        });
      } catch (error) {
        console.error("Failed to start scripted tracker session:", error);
        if (error instanceof Error) {
          window.alert(error.message);
        }
      }
    },
    [activeScript, projectId, projectSlug, pushSelection, trackerType]
  );

  const handleStartScriptedSession = useCallback(
    (item: TrackerItem, event?: React.MouseEvent) => {
      setShowRunScripts(false);
      if (participants.length === 0) {
        window.alert("Add at least one agent to this project before starting a scripted session.");
        return;
      }
      if (participants.length === 1) {
        void executeWithAgent(item, participants[0]);
        return;
      }
      // Multiple agents — show picker
      const rect = (event?.currentTarget as HTMLElement)?.getBoundingClientRect();
      setPickerItem(item);
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
                  onClick={() => void refreshItems()}
                  title="Refresh tickets"
                  aria-label="Refresh tickets"
                  disabled={itemsLoading}
                >
                  <RefreshCw size={16} className={itemsLoading ? "animate-spin" : undefined} />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                  onClick={() => {
                    setShowRunScripts(false);
                    setShowSettings(true);
                  }}
                  title="Tracker settings"
                >
                  <Settings size={16} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
                {showStatusFilter ? (
                  <MultiFilterPopdown
                    label="Status"
                    values={selectedStatusCategories}
                    options={statusOptions}
                    activeClasses="border-amber-500/30 bg-amber-500/10 text-amber-300"
                    onChange={setSelectedStatusCategories}
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
                {showGroupFilter ? (
                  <FilterSelect
                    label="Group"
                    value={selectedGroupId}
                    options={groupOptions}
                    activeClasses="border-purple-500/30 bg-purple-500/10 text-purple-400"
                    onChange={setSelectedGroupId}
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
              {itemsLoading && items.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  Loading tickets...
                </div>
              ) : items.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  No tickets found.
                </div>
              ) : (
                <>
                  {sortedItems.map((item, idx) => (
                    <React.Fragment key={item.id}>
                      {pinnedItemIds.size > 0 &&
                        !pinnedItemIds.has(item.id) &&
                        (idx === 0 || pinnedItemIds.has(sortedItems[idx - 1].id)) && (
                          <div className="mx-4 border-t border-amber-500/20" />
                        )}
                      <TicketRow
                        item={item}
                        selected={selectedItem?.id === item.id}
                        pinned={pinnedItemIds.has(item.id)}
                        activeAgents={issueActiveAgents.get(item.id)}
                        participants={participants}
                        onSelect={() => {
                          setTouchPanelTab("runs");
                          pushSelection({
                            issue: item.id,
                            run: null,
                          });
                        }}
                        onTogglePin={() => togglePin(item.id)}
                      />
                    </React.Fragment>
                  ))}
                  {hasMore ? (
                    <div
                      ref={sentinelRef}
                      className="py-2 text-center text-xs text-[var(--muted-foreground)]"
                    >
                      {itemsLoading ? "Loading..." : "Load more"}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {selectedItem ? (
            <div className="absolute inset-0 z-20 flex flex-col bg-[var(--background)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                    {selectedItem.identifier}
                  </div>
                  <div className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {selectedItem.title}
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
                        disabled={!selectedItem}
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
                    item={selectedItem ?? {
                      id: selectedRun.issueId,
                      identifier: selectedRun.issueIdentifier,
                      title: selectedRun.issueTitle,
                      status: selectedRun.issueStatus,
                      statusCategory: "todo",
                      labels: [],
                      trackerId: "",
                      trackerType,
                      assignee: selectedRun.issueAssignee ? { id: "", name: selectedRun.issueAssignee } : undefined,
                      updatedAt: selectedRun.updatedAt,
                      createdAt: selectedRun.updatedAt,
                      url: "",
                    }}
                    run={selectedRun}
                    participants={participants}
                    itemStatusOptions={itemStatusOptions}
                    itemStatusUpdating={updatingItemId === selectedRun.issueId}
                    onItemStatusChange={handleItemStatusChange}
                    onBack={() => replaceSelection({ run: null })}
                  />
                ) : participants.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
                    Add at least one agent to this project to start a session.
                  </div>
                ) : (
                  <TicketPanel
                    key={selectedItem.id}
                    item={selectedItem}
                    trackerType={trackerType}
                    runs={runs}
                    participants={participants}
                    projectId={projectId}
                    projectSlug={projectSlug}
                    itemStatusOptions={itemStatusOptions}
                    itemStatusUpdating={updatingItemId === selectedItem.id}
                    onItemStatusChange={handleItemStatusChange}
                    activeSessionScriptLabel={activeSessionScriptLabel}
                    onOpenSessionScripts={() => setShowRunScripts(true)}
                    onStartScriptedSession={(event) => handleStartScriptedSession(selectedItem, event)}
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
              onClick={() => void refreshItems()}
              title="Refresh tickets"
              aria-label="Refresh tickets"
              disabled={itemsLoading}
            >
              <RefreshCw size={16} className={itemsLoading ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
              onClick={() => {
                setShowRunScripts(false);
                setShowSettings(true);
              }}
              title="Tracker settings"
            >
              <Settings size={16} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2">
            {showStatusFilter ? (
              <MultiFilterPopdown
                label="Status"
                values={selectedStatusCategories}
                options={statusOptions}
                activeClasses="border-amber-500/30 bg-amber-500/10 text-amber-300"
                onChange={setSelectedStatusCategories}
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
            {showGroupFilter ? (
              <FilterSelect
                label="Group"
                value={selectedGroupId}
                options={groupOptions}
                activeClasses="border-purple-500/30 bg-purple-500/10 text-purple-400"
                onChange={setSelectedGroupId}
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

        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
        <div className="relative flex-1 overflow-y-auto">
          {itemsLoading && items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
              Loading tickets...
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
              No tickets found.
            </div>
          ) : (
            <>
              {/* Unified list: groups rendered inline at first-member position */}
              {(() => {
                const pendingSet = showGroupNamePrompt ? new Set(pendingGroupTaskIds) : null;

                // Build a map: itemId → group (for the first member of each group)
                const firstMemberToGroup = new Map<string, typeof taskGroups[number]>();
                for (const group of taskGroups) {
                  const firstInSort = sortedItems.find((i) => group.task_ids.includes(i.id));
                  if (firstInSort) firstMemberToGroup.set(firstInSort.id, group);
                }

                // Pending group prompt: find insert position
                const pendingTickets = showGroupNamePrompt
                  ? pendingGroupTaskIds
                      .map((id) => sortedItems.find((i) => i.id === id))
                      .filter(Boolean)
                      .map((i) => ({ id: i!.id, identifier: i!.identifier, title: i!.title, status: STATUS_LABELS[i!.status] ?? i!.status }))
                  : [];

                // Track which groups we've rendered
                const renderedGroups = new Set<string>();
                let looseIdx = 0;

                return sortedItems.map((item) => {
                  // Skip pending tickets
                  if (pendingSet?.has(item.id)) {
                    // Render prompt at target position
                    if (item.id === pendingGroupTargetId && showGroupNamePrompt) {
                      return (
                        <GroupNamePrompt
                          key="__pending-group__"
                          tickets={pendingTickets}
                          onConfirm={handleCreateGroup}
                          onCancel={() => {
                            setShowGroupNamePrompt(false);
                            setPendingGroupTaskIds([]);
                            setPendingGroupTargetId(null);
                          }}
                        />
                      );
                    }
                    return null;
                  }

                  // If this item is the first member of a group, render the group here
                  const group = firstMemberToGroup.get(item.id);
                  if (group && !renderedGroups.has(group.id)) {
                    renderedGroups.add(group.id);
                    const groupItems = group.task_ids
                      .map((id) => sortedItems.find((i) => i.id === id))
                      .filter(Boolean) as TrackerItem[];
                    return (
                      <React.Fragment key={`group-${group.id}`}>
                        <FolderRow
                          groupId={group.id}
                          name={group.name}
                          count={groupItems.length}
                          collapsed={!!group.collapsed}
                          selected={selectedGroupTaskGroupId === group.id}
                          onToggleCollapse={() =>
                            updateGroup(group.id, { collapsed: !group.collapsed })
                          }
                          onSelect={() =>
                            pushSelection({ group: group.id, issue: null, run: null })
                          }
                        />
                        {!group.collapsed &&
                          groupItems.map((gi, giIdx) => (
                            <TicketRow
                              key={gi.id}
                              item={gi}
                              selected={selectedItem?.id === gi.id}
                              pinned={pinnedItemIds.has(gi.id)}
                              activeAgents={issueActiveAgents.get(gi.id)}
                              participants={participants}
                              draggable
                              multiSelected={multiSelectedItemIds.has(gi.id)}
                              treeConnector={giIdx === groupItems.length - 1 ? "last" : "mid"}
                              onSelect={(event) => {
                                if (event && (event.metaKey || event.ctrlKey)) {
                                  toggleItemMultiSelect(gi.id);
                                } else {
                                  pushSelection({
                                    issue: gi.id,
                                    run: null,
                                    group: null,
                                  });
                                }
                              }}
                              onTogglePin={() => togglePin(gi.id)}
                            />
                          ))}
                      </React.Fragment>
                    );
                  }

                  // Skip grouped items (already rendered with their group)
                  if (groupedItemIds.has(item.id)) return null;

                  // Loose ticket
                  const currentLooseIdx = looseIdx++;
                  const prevLoose = currentLooseIdx > 0
                    ? sortedItems.filter((i) => !groupedItemIds.has(i.id) && (!pendingSet || !pendingSet.has(i.id)))[currentLooseIdx - 1]
                    : null;
                  return (
                    <React.Fragment key={item.id}>
                      {pinnedItemIds.size > 0 &&
                        !pinnedItemIds.has(item.id) &&
                        (currentLooseIdx === 0 || (prevLoose && pinnedItemIds.has(prevLoose.id))) && (
                          <div className="mx-4 border-t border-amber-500/20" />
                        )}
                      <TicketRow
                        item={item}
                        selected={selectedItem?.id === item.id}
                        pinned={pinnedItemIds.has(item.id)}
                        activeAgents={issueActiveAgents.get(item.id)}
                        participants={participants}
                        draggable
                        multiSelected={multiSelectedItemIds.has(item.id)}
                        onSelect={(event) => {
                          if (event && (event.metaKey || event.ctrlKey)) {
                            toggleItemMultiSelect(item.id);
                          } else {
                            pushSelection({
                              issue: item.id,
                              run: null,
                              group: null,
                            });
                          }
                        }}
                        onTogglePin={() => togglePin(item.id)}
                      />
                    </React.Fragment>
                  );
                });
              })()}
              {hasMore ? (
                <div
                  ref={sentinelRef}
                  className="py-2 text-center text-xs text-[var(--muted-foreground)]"
                >
                  {itemsLoading ? "Loading..." : "Load more"}
                </div>
              ) : null}
            </>
          )}
          <SelectionBar
            count={multiSelectedItemIds.size}
            onGroup={handleMultiSelectGroup}
            onClear={() => setMultiSelectedItemIds(new Set())}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragActiveId && (() => {
            const dragItem = sortedItems.find((i) => i.id === dragActiveId);
            if (!dragItem) return null;
            return (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--primary)]/30 bg-[var(--card-bg)] px-4 py-2.5 text-sm shadow-xl backdrop-blur-sm">
                <span className="w-24 shrink-0 whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
                  {dragItem.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">
                  {dragItem.title}
                </span>
              </div>
            );
          })()}
        </DragOverlay>
        </DndContext>
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
            item={selectedItem ?? {
              id: selectedRun.issueId,
              identifier: selectedRun.issueIdentifier,
              title: selectedRun.issueTitle,
              status: selectedRun.issueStatus,
              statusCategory: "todo",
              labels: [],
              trackerId: "",
              trackerType,
              assignee: selectedRun.issueAssignee ? { id: "", name: selectedRun.issueAssignee } : undefined,
              updatedAt: selectedRun.updatedAt,
              createdAt: selectedRun.updatedAt,
              url: "",
            }}
            run={selectedRun}
            participants={participants}
            itemStatusOptions={itemStatusOptions}
            itemStatusUpdating={updatingItemId === selectedRun.issueId}
            onItemStatusChange={handleItemStatusChange}
            onBack={() => replaceSelection({ run: null })}
          />
        ) : selectedGroup && !selectedItem ? (
          <GroupPanel
            group={selectedGroup}
            items={items}
            trackerType={trackerType}
            participants={participants}
            projectId={projectId}
            projectSlug={projectSlug}
            onUpdateName={(name) => updateGroup(selectedGroup.id, { name })}
            onDelete={async () => {
              await deleteGroup(selectedGroup.id);
              replaceSelection({ group: null });
            }}
            onSelectItem={(itemId) =>
              pushSelection({ issue: itemId, group: null, run: null })
            }
            onRunCreated={(runId) => pushSelection({ run: runId })}
            onSelectRun={(runId) => pushSelection({ run: runId })}
          />
        ) : !selectedItem ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Select a ticket from the list.
          </div>
        ) : participants.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
            Add at least one agent to this project to start a session.
          </div>
        ) : (
          <TicketPanel
            key={selectedItem.id}
            item={selectedItem}
            trackerType={trackerType}
            runs={runs}
            participants={participants}
            projectId={projectId}
            projectSlug={projectSlug}
            itemStatusOptions={itemStatusOptions}
            itemStatusUpdating={updatingItemId === selectedItem.id}
            onItemStatusChange={handleItemStatusChange}
            activeSessionScriptLabel={activeSessionScriptLabel}
            onOpenSessionScripts={() => setShowRunScripts(true)}
            onStartScriptedSession={(event) => handleStartScriptedSession(selectedItem, event)}
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
        <TrackerSettingsModal
          trackerType={trackerType}
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
      {pickerItem && pickerAnchor && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setPickerItem(null);
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
                onClick={() => void executeWithAgent(pickerItem, agent)}
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

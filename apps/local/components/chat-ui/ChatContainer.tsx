"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { UI_POLL_CHAT_CHECK_MS, UI_POLL_CHAT_ALT_MS } from "@/lib/constants/timing";
import { useSearchParams } from "next/navigation";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { useThreadState } from "@/hooks/useThreadState";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import "@/styles/workspaceSidebar.css";
import { MessageList } from "./MessageList";
import { ThreadView } from "./ThreadView";
import { SearchResults } from "./SearchResults";
import { Composer } from "./Composer";
import {
  loadWorkspaceSidebarVisible,
  persistWorkspaceSidebarVisible,
} from "@/state/uiSettings";
import { loadWorkspaceWidth, persistWorkspaceWidth } from "@/state/windowState";
import {
  loadStoredActiveParticipantIds,
  persistStoredActiveParticipantIds,
} from "@/state/projectAgentConfig";
import {
  fetchUserPreferences,
  updateUserPreferences,
} from "@/services/userPreferences";
import type { SlashCommand } from "@/hooks/useCommandAutocomplete";
import type { Participant, GroupMessage, MessageSearchResponse, MessageSearchResult } from "@/lib/types";
import {
  orderParticipantIds,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import type { ThreadStatus } from "@/lib/storage/thread-adapter";
import type { TaskDraftMessage } from "@/types/tasks";
import { buildTasks } from "@/services/agxService";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useProjectsWithAgents, useProjects } from "@/hooks/useProjects";
import { Search, ChevronLeft, SquareTerminal, PanelLeftOpen, Moon, Sun, BookOpen, LoaderCircle } from "lucide-react";
import { LogPanel } from "./LogPanel";
import { StatusIndicator } from "./StatusIndicator";

const LEGACY_THREAD_ID = "global";
const SUMMARY_MARKER = "<!-- thread-summary -->";
const TASK_DRAFT_MARKER = "<!-- task-draft -->";
const THEME_STORAGE_KEY = "agx-theme";

interface ThreadKnowledgeRun {
  id: string;
  status: "running" | "completed" | "failed";
  requestedScopes: Array<"repo" | "project">;
  repoInsertedCount: number;
  projectInsertedCount: number;
  error: string | null;
  updatedAt: string;
  completedAt: string | null;
}

function stripThoughts(text: string): string {
  return text.replace(/(?:^|\n)Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.?\s*/g, "\n").trim();
}

function stripInternalMarkers(text: string): string {
  return text
    .replaceAll(SUMMARY_MARKER, "")
    .replaceAll(TASK_DRAFT_MARKER, "")
    .trim();
}

function cleanMarkdownBlock(text: string, removeThoughts = false): string {
  const content = removeThoughts ? stripThoughts(text) : text;
  return stripInternalMarkers(content)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function taskDraftToMarkdown(draft: TaskDraftMessage): string {
  if (draft.tasks.length === 0) return "";

  const titleById = new Map(draft.tasks.map((task) => [task.id, task.title.trim()]));
  const lines: string[] = ["## Draft Tasks", ""];

  if (draft.projectName) {
    lines.push(`Project: ${draft.projectName}`);
  }
  if (draft.buildStatus) {
    lines.push(`Build status: ${draft.buildStatus.replaceAll("_", " ")}`);
  }
  if (draft.projectName || draft.buildStatus) {
    lines.push("");
  }

  draft.tasks.forEach((task, index) => {
    const title = cleanMarkdownBlock(task.title) || `Task ${index + 1}`;
    const description = cleanMarkdownBlock(task.description);
    const deps = (task.dependsOn || [])
      .map((id) => titleById.get(id)?.trim())
      .filter((value): value is string => Boolean(value));
    const remoteTaskId = draft.builtTaskIds?.[task.id];

    lines.push(`${index + 1}. [ ] **${title}**`);
    if (description) {
      lines.push(description);
    }
    if (deps.length > 0) {
      lines.push(`Depends on: ${deps.join(", ")}`);
    }
    if (remoteTaskId) {
      lines.push(`agx task id: \`${remoteTaskId}\``);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

function getTimeAgo(ts: number) {
  if (!ts) return "recently";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ts);
}

async function fetchLatestThreadKnowledgeRun(rootMessageId: string): Promise<ThreadKnowledgeRun | null> {
  const response = await fetch(`/api/threads/knowledge?rootMessageId=${encodeURIComponent(rootMessageId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load thread knowledge run");
  }
  const payload = await response.json().catch((err) => { console.warn('[ChatContainer] failed to parse thread knowledge response:', err); return null; });
  return payload?.run ?? null;
}

function getOrderedParticipantIds(
  participants: Participant[],
  projects: ReturnType<typeof useProjectsWithAgents>["projects"],
  activeThreadId: string | null
): string[] {
  const participantIdSet = new Set(participants.map((participant) => participant.id));
  const threadProject = activeThreadId
    ? projects.find((project) => project.thread_ids?.includes(activeThreadId))
    : projects[0];
  const routingOrderIds = threadProject
    ? threadProject.agents.map((agent) => agent.agent_id).filter((id) => participantIdSet.has(id))
    : [];

  if (threadProject) {
    return routingOrderIds;
  }

  if (routingOrderIds.length === 0) {
    return participants.map((participant) => participant.id);
  }

  return routingOrderIds;
}

function reconcileActiveParticipantIds(
  orderedParticipantIds: string[],
  storedIds: string[] | null
): string[] {
  if (storedIds === null) {
    return orderedParticipantIds;
  }

  const enabledIds = new Set(storedIds);
  return orderedParticipantIds.filter((id) => enabledIds.has(id));
}

function toMarkdown(
  messages: GroupMessage[],
  participants: Participant[],
  taskDraft?: TaskDraftMessage
): string {
  const pMap = Object.fromEntries(participants.map((p) => [p.id, p]));
  const lines: string[] = [];

  for (const msg of messages) {
    const name = msg.role === "user"
      ? "You"
      : msg.participantId
        ? pMap[msg.participantId]?.name || msg.participantId
        : "Assistant";
    const clean = cleanMarkdownBlock(msg.content, msg.role !== "user");
    if (!clean) {
      continue;
    }

    lines.push(`**${name}:**`);
    lines.push("");
    lines.push(clean);
    lines.push("");
  }

  if (taskDraft) {
    const taskMd = taskDraftToMarkdown(taskDraft);
    if (taskMd) {
      lines.push(taskMd);
    }
  }

  return lines.join("\n").trim();
}

interface ChatContainerProps {
  projectSlug?: string;
  initialThreadId?: string;
  initialRootMessageId?: string;
  showSidebar?: boolean;
}

export function ChatContainer({
  projectSlug,
  initialThreadId,
  initialRootMessageId,
  showSidebar = true,
}: ChatContainerProps = {}) {
  const searchParams = useSearchParams();
  const {
    threads,
    activeThreadId,
    selectThread,
    createThread,
    deleteThread,
    updateThreadMessages,
    isCreating,
    deletingThreadId,
    renamingThreadId,
    isLoading: threadsLoading,
    isRestoringActiveThread,
    renameThread,
    updateThreadStatus,
    updateThreadOutcomeNote,
    updateMessageThreadStatus,
    updateMessageOutcomeNote,
  } = useThreadState(initialThreadId);
  const { messages, setMessages, logs, sendMessage, loadHistory, clearLogs, chatRuns, setChatRuns, stop, stopThread } =
    useGroupChat(activeThreadId);
  const { activeAgents: polledActiveAgents, processes: activeProcesses, streaming, chatRuns: polledChatRuns, poll } = useProcessPolling(
    activeThreadId ? { workspaceId: activeThreadId } : null,
    { messages, setMessages }
  );
  const activeChatRuns = useMemo(() => {
    const now = Date.now();
    const byId = new Map(polledChatRuns.map((run) => [run.chatRunId, run]));

    for (const run of chatRuns) {
      if (!run.optimistic || byId.has(run.chatRunId)) continue;
      if (now - (run.enqueuedAt ?? 0) > 5000) continue;
      byId.set(run.chatRunId, run);
    }

    return Array.from(byId.values()).filter(
      (run) => run.status === "queued" || run.status === "running"
    );
  }, [chatRuns, polledChatRuns]);
  const composerActivityStatus =
    polledActiveAgents.size > 0 || activeChatRuns.some((run) => run.status === "running")
      ? "working"
      : activeChatRuns.some((run) => run.status === "queued")
        ? "queued"
        : "ready";
  const loading = composerActivityStatus !== "ready";

  useEffect(() => {
    setChatRuns((prev) => {
      const now = Date.now();
      const byId = new Map(
        prev
          .filter((run) => typeof run.chatRunId === "string" && run.chatRunId.length > 0)
          .map((run) => [run.chatRunId, run])
      );

      for (const run of polledChatRuns) {
        if (!run?.chatRunId) continue;
        byId.set(run.chatRunId, run);
      }

      const next = Array.from(byId.values()).filter((run) => {
        if (!run.optimistic) return true;
        if (polledChatRuns.some((polledRun) => polledRun.chatRunId === run.chatRunId)) return true;
        return now - (run.enqueuedAt ?? 0) <= 5000;
      });

      return next.sort((a, b) =>
        String(a.chatRunId || "").localeCompare(String(b.chatRunId || ""))
      );
    });
  }, [polledChatRuns, setChatRuns]);

  const cancelChatRun = useCallback(async (chatRunId: string) => {
    await fetch(`/api/chat-runs/${encodeURIComponent(chatRunId)}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "cancel", reason: "Stopped from chat UI" }),
    }).catch((err) => console.warn('[ChatContainer] cancel chat run failed:', err));
  }, []);

  // Wrap stop functions to immediately refresh polling state
  const handleStop = useCallback(async () => {
    const latestRun = activeChatRuns[0];
    if (latestRun?.chatRunId) {
      await cancelChatRun(latestRun.chatRunId);
    }
    await stop();
    await poll();
  }, [activeChatRuns, cancelChatRun, stop, poll]);

  const handleStopThread = useCallback(async (rootMessageId: string) => {
    const matchingRun = activeChatRuns.find((run) => run.rootMessageId === rootMessageId);
    if (matchingRun?.chatRunId) {
      await cancelChatRun(matchingRun.chatRunId);
    }
    await stopThread(rootMessageId);
    await poll();
  }, [activeChatRuns, cancelChatRun, stopThread, poll]);

  const handleStopRef = useRef(handleStop);
  useEffect(() => {
    handleStopRef.current = handleStop;
  }, [handleStop]);
  const {
    projects,
    createProject,
    deleteProject,
    addAgent: addAgentToProject,
    removeAgent: removeAgentFromProject,
    reorderAgents: reorderProjectAgents,
  } = useProjectsWithAgents();
  const { projects: projectList, updateProject } = useProjects();

  // Projects scoped to the current thread
  const threadProjects = useMemo(
    () => activeThreadId ? projects.filter((project) => project.thread_ids?.includes(activeThreadId)) : projects,
    [projects, activeThreadId]
  );

  // Derive project slug from route prop or thread association so messages sent
  // from the root page still carry project context.
  const effectiveProjectSlug = useMemo(
    () => projectSlug || threadProjects[0]?.slug || undefined,
    [projectSlug, threadProjects]
  );

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoaded, setParticipantsLoaded] = useState(false);
  const [activeParticipantIds, setActiveParticipantIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [workspaceSidebarVisible, setWorkspaceSidebarVisible] = useState(false);
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(368);
  const workspaceSidebarHydratedRef = useRef(false);

  // Sync sidebar visibility from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = loadWorkspaceSidebarVisible();
    workspaceSidebarHydratedRef.current = true;
    setWorkspaceSidebarVisible(stored);
    setWorkspaceSidebarWidth(loadWorkspaceWidth() || 368);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [autoModeThreads, setAutoModeThreads] = useState<Set<string>>(new Set());
  const [pendingAutoMode, setPendingAutoMode] = useState(false);
  const [knowledgeExtractionPending, setKnowledgeExtractionPending] = useState(false);
  const [threadKnowledgeRun, setThreadKnowledgeRun] = useState<ThreadKnowledgeRun | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(initialRootMessageId ?? null);
  const routeOpenThreadId = searchParams.get("open")?.trim() || null;
  const autoMode = openThreadId ? autoModeThreads.has(openThreadId) : pendingAutoMode;

  // Hydrate & poll ship mode from server when a thread is opened
  useEffect(() => {
    if (!openThreadId) return;
    let cancelled = false;

    const check = () => {
      fetch(`/api/schedules?rootMessageId=${encodeURIComponent(openThreadId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setAutoModeThreads((prev) => {
            const has = prev.has(openThreadId);
            if (data.active && !has) {
              const next = new Set(prev); next.add(openThreadId); return next;
            }
            if (!data.active && has) {
              const next = new Set(prev); next.delete(openThreadId); return next;
            }
            return prev;
          });
        })
        .catch((err) => console.warn('[ChatContainer] check auto-mode status failed:', err));
    };

    check();
    const interval = setInterval(check, UI_POLL_CHAT_CHECK_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [openThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate all ship-mode threads for message list indicators
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch("/api/schedules")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.activeRootMessageIds) return;
          setAutoModeThreads((prev) => {
            const next = new Set(data.activeRootMessageIds as string[]);
            if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
            return next;
          });
        })
        .catch((err) => console.warn('[ChatContainer] fetch schedules failed:', err));
    };
    check();
    const interval = setInterval(check, UI_POLL_CHAT_ALT_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL to reflect the currently open thread
  useEffect(() => {
    if (openThreadId) {
      const nextPath = projectSlug
        ? `/projects/${projectSlug}/thread/${encodeURIComponent(activeThreadId ?? initialThreadId ?? "")}?open=${encodeURIComponent(openThreadId)}`
        : `/thread/${openThreadId}`;
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.replaceState(null, "", projectSlug ? `/projects/${projectSlug}/thread/${encodeURIComponent(activeThreadId ?? initialThreadId ?? "")}` : "/");
    }
  }, [activeThreadId, initialThreadId, openThreadId, projectSlug]);

  useEffect(() => {
    if (!projectSlug) {
      return;
    }

    setOpenThreadId((current) => (current === routeOpenThreadId ? current : routeOpenThreadId));
  }, [projectSlug, routeOpenThreadId]);

  // Resolve initialRootMessageId → workspace thread on mount
  useEffect(() => {
    if (!initialRootMessageId) return;
    (async () => {
      try {
        const res = await fetch(`/api/messages/${initialRootMessageId}`);
        if (!res.ok) return;
        const { threadId } = await res.json();
        if (threadId) selectThread(threadId);
      } catch {}
    })();
  }, [initialRootMessageId, selectThread]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [summarizingThreads, setSummarizingThreads] = useState<Set<string>>(new Set());
  const [deletingThreadRootId, setDeletingThreadRootId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ type: "thread" | "message"; id: string; preview?: string } | null>(null);
  const [taskDrafts, setTaskDraftsRaw] = useState<Record<string, TaskDraftMessage>>({});
  const setTaskDrafts: typeof setTaskDraftsRaw = useCallback((update) => {
    setTaskDraftsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      // persist each changed draft
      if (activeThreadId) {
        for (const [msgId, draft] of Object.entries(next)) {
          if (prev[msgId] !== draft) {
            fetch("/api/task-drafts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threadId: activeThreadId, messageId: msgId, draft }),
            }).catch((err) => console.warn('[ChatContainer] persist task draft failed:', err));
          }
        }
      }
      return next;
    });
  }, [activeThreadId]);
  const [extractingTasks, setExtractingTasks] = useState<Set<string>>(new Set());
  const [buildingDrafts, setBuildingDrafts] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingOpenThreadIdRef = useRef<string | null>(null);
  const highlightClearTimeoutRef = useRef<number | null>(null);
  const lastUnknownParticipantSignatureRef = useRef<string>("");

  const reloadParticipants = useCallback(
    async (markLoaded = false) => {
      try {
        const res = await fetch("/api/participants");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        setParticipants(data as Participant[]);
      } finally {
        if (markLoaded) {
          setParticipantsLoaded(true);
        }
      }
    },
    []
  );

  const persistWorkspaceSidebarPreferenceRemotely = useCallback(async (visible: boolean) => {
    try {
      await updateUserPreferences({ threadSidebarVisible: visible });
    } catch (error) {
      console.error("Unable to persist thread sidebar preference", error);
    }
  }, [updateUserPreferences]);

  const persistSidebarPreference = useCallback(
    (visible: boolean) => {
      persistWorkspaceSidebarVisible(visible);
      void persistWorkspaceSidebarPreferenceRemotely(visible);
    },
    [persistWorkspaceSidebarPreferenceRemotely]
  );

  const normalizedSearchQuery = searchQuery.trim();
  const searchActive = normalizedSearchQuery.length > 0;
  const threadTitleById = useMemo(
    () =>
      Object.fromEntries(
        threads.map((thread) => [thread.id, thread.title?.trim() || "Untitled thread"])
      ),
    [threads]
  );

  const activeThreadParticipants = useMemo(() => {
    if (!openThreadId) return [];
    const threadMsgs = [
      messages.find((m) => m.id === openThreadId),
      ...messages.filter((m) => m.rootMessageId === openThreadId)
    ].filter(Boolean) as GroupMessage[];

    const ids = new Set(threadMsgs.map((m) => m.participantId).filter(Boolean));
    Object.keys(streaming).forEach((pid) => {
      if (streaming[pid].rootMessageId === openThreadId) {
        ids.add(pid);
      }
    });
    return participants.filter((p) => ids.has(p.id));
  }, [openThreadId, messages, streaming, participants]);

  const activeParticipants = useMemo(() => {
    const participantMap = new Map(participants.map((p) => [p.id, p]));
    return activeParticipantIds
      .map((id) => participantMap.get(id))
      .filter(Boolean) as typeof participants;
  }, [participants, activeParticipantIds]);
  const projectMentions = useMemo(
    () => projectList.map((project) => ({ id: project.id, name: project.name, slug: project.slug })),
    [projectList]
  );

  const lastThreadUpdate = useMemo(() => {
    if (!openThreadId) return 0;
    const threadMsgs = [
      messages.find((m) => m.id === openThreadId),
      ...messages.filter((m) => m.rootMessageId === openThreadId)
    ].filter(Boolean) as GroupMessage[];
    if (threadMsgs.length === 0) return 0;
    return Math.max(...threadMsgs.map((m) => m.timestamp));
  }, [openThreadId, messages]);

  const activeThreadTitle = useMemo(() => {
    if (!openThreadId) return "";
    const rootMsg = messages.find((m) => m.id === openThreadId);
    if (!rootMsg) return "Discussion";
    const text = rootMsg.content.trim();
    return text.length > 60 ? text.slice(0, 60) + "..." : text;
  }, [openThreadId, messages]);

  const activeThreadStatus = useMemo((): { value: ThreadStatus; label: string; color: string } | null => {
    if (!openThreadId) return null;
    const rootMsg = messages.find((m) => m.id === openThreadId);
    const status = rootMsg?.threadStatus ?? "active";
    const map: Record<ThreadStatus, { label: string; color: string }> = {
      active: { label: "Active", color: "#f59e0b" },
      paused: { label: "Paused", color: "#f97316" },
      "in-review": { label: "In Review", color: "#6b7280" },
      done: { label: "Done", color: "#3b82f6" },
      archived: { label: "Archived", color: "#9ca3af" },
    };
    return { value: status, ...map[status] };
  }, [openThreadId, messages]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchTotal(0);
    setSearchError(null);
    setSearchLoading(false);
  }, []);

  const copyAsMarkdown = useCallback(() => {
    const md = toMarkdown(messages, participants);
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [messages, participants]);

  const [pendingThreadInsert, setPendingThreadInsert] = useState<{ title: string; threadId: string; messages: GroupMessage[] } | null>(null);

  const handleAddToChat = useCallback((rootMessageId: string) => {
    const rootMsg = messages.find((m) => m.id === rootMessageId);
    if (!rootMsg) return;

    const threadMsgs = [
      rootMsg,
      ...messages.filter((m) => m.rootMessageId === rootMessageId).sort((a, b) => a.timestamp - b.timestamp)
    ];

    const title = rootMsg.content.slice(0, 60).replace(/\n/g, " ").trim() || "Untitled";
    setPendingThreadInsert({ title, threadId: rootMessageId, messages: threadMsgs });
  }, [messages]);

  const handleCopyThread = useCallback((rootMessageId: string) => {
    const threadMsgs = [
      messages.find((m) => m.id === rootMessageId),
      ...messages.filter((m) => m.rootMessageId === rootMessageId).sort((a, b) => a.timestamp - b.timestamp)
    ].filter(Boolean) as GroupMessage[];

    const md = toMarkdown(threadMsgs, participants, taskDrafts[rootMessageId]);
    navigator.clipboard.writeText(md).catch(err => console.error("Failed to copy thread", err));
  }, [messages, participants, taskDrafts]);

  const handleLearnFromDiscussion = useCallback(async () => {
    if (!openThreadId) return;

    setKnowledgeExtractionPending(true);
    try {
      const scopes: string[] = ["repo"];
      if (effectiveProjectSlug) scopes.push("project");

      const response = await fetch("/api/threads/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootMessageId: openThreadId, scopes }),
      });
      const payload = await response.json().catch((err) => { console.warn('[ChatContainer] failed to parse knowledge extraction response:', err); return null; });
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Request failed");
      }
      setThreadKnowledgeRun(payload?.run ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      window.alert(`Failed to extract knowledge: ${message}`);
    } finally {
      setKnowledgeExtractionPending(false);
    }
  }, [openThreadId, effectiveProjectSlug]);

  useEffect(() => {
    if (!openThreadId) {
      setThreadKnowledgeRun(null);
      setKnowledgeExtractionPending(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const run = await fetchLatestThreadKnowledgeRun(openThreadId);
        if (cancelled) return;
        setThreadKnowledgeRun(run);
      } catch {
        if (!cancelled) {
          setThreadKnowledgeRun(null);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [openThreadId]);

  useEffect(() => {
    if (!openThreadId || threadKnowledgeRun?.status !== "running") {
      return;
    }

    let cancelled = false;
    const pollRun = async () => {
      try {
        const run = await fetchLatestThreadKnowledgeRun(openThreadId);
        if (cancelled) return;
        setThreadKnowledgeRun(run);
      } catch {
        // Preserve the current running state on transient polling failures.
      }
    };

    void pollRun();
    const interval = window.setInterval(() => {
      void pollRun();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [openThreadId, threadKnowledgeRun?.status]);

  const isKnowledgeExtractionRunning = threadKnowledgeRun?.status === "running";
  const knowledgeButtonDisabled = knowledgeExtractionPending || isKnowledgeExtractionRunning;
  const latestKnowledgeInsertedCount = (threadKnowledgeRun?.repoInsertedCount ?? 0) + (threadKnowledgeRun?.projectInsertedCount ?? 0);
  const knowledgeStatusText = useMemo(() => {
    if (!threadKnowledgeRun) return null;
    if (threadKnowledgeRun.status === "running") {
      return "Learning in progress";
    }
    if (threadKnowledgeRun.status === "failed") {
      return "Last learning run failed";
    }
    if (latestKnowledgeInsertedCount > 0) {
      const noun = latestKnowledgeInsertedCount === 1 ? "insight" : "insights";
      return `Learned ${latestKnowledgeInsertedCount} ${noun}`;
    }
    return "No new learnings";
  }, [latestKnowledgeInsertedCount, threadKnowledgeRun]);

  useEffect(() => {
    void reloadParticipants(true);
  }, [reloadParticipants]);

  const unresolvedParticipantIds = useMemo(() => {
    if (!participantsLoaded) return [];
    const knownIds = new Set(participants.map((participant) => participant.id));
    const unresolved = new Set<string>();

    for (const message of messages) {
      if (message.role !== "assistant") continue;
      if (!message.participantId) continue;
      if (!knownIds.has(message.participantId)) {
        unresolved.add(message.participantId);
      }
    }

    for (const participantId of Object.keys(streaming)) {
      if (!knownIds.has(participantId)) {
        unresolved.add(participantId);
      }
    }

    return Array.from(unresolved).sort();
  }, [messages, participants, participantsLoaded, streaming]);

  useEffect(() => {
    if (!participantsLoaded) return;
    const signature = unresolvedParticipantIds.join("|");
    if (!signature) {
      lastUnknownParticipantSignatureRef.current = "";
      return;
    }
    if (lastUnknownParticipantSignatureRef.current === signature) {
      return;
    }
    lastUnknownParticipantSignatureRef.current = signature;
    void reloadParticipants(false);
  }, [participantsLoaded, reloadParticipants, unresolvedParticipantIds]);

  useEffect(() => {
    if (!participantsLoaded) {
      return;
    }
    const orderedParticipantIds = getOrderedParticipantIds(participants, projects, activeThreadId);

    if (!activeThreadId) {
      setActiveParticipantIds(orderedParticipantIds);
      return;
    }

    const storedIds = loadStoredActiveParticipantIds(activeThreadId);
    if (storedIds === null) {
      setActiveParticipantIds(orderedParticipantIds);
      return;
    }

    const reconciled = reconcileActiveParticipantIds(orderedParticipantIds, storedIds);
    const effective = reconciled.length > 0 ? reconciled : orderedParticipantIds;
    if (
      effective.length !== storedIds.length ||
      effective.some((id, index) => storedIds[index] !== id)
    ) {
      persistStoredActiveParticipantIds(activeThreadId, effective);
    }
    setActiveParticipantIds(effective);
  }, [activeThreadId, participants, participantsLoaded, projects]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const preferences = await fetchUserPreferences();
        if (cancelled) return;
        setWorkspaceSidebarVisible((current) => {
          if (current === preferences.threadSidebarVisible) {
            return current;
          }
          if (workspaceSidebarHydratedRef.current) {
            void persistWorkspaceSidebarPreferenceRemotely(current);
            return current;
          }
          persistWorkspaceSidebarVisible(preferences.threadSidebarVisible);
          return preferences.threadSidebarVisible;
        });
      } catch (error) {
        console.error("Failed to load user preferences", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [persistWorkspaceSidebarPreferenceRemotely]);

  useEffect(() => {
    if (!threadsLoading && !isCreating && threads.length === 0) {
      void createThread({ id: LEGACY_THREAD_ID, title: "General" });
    }
  }, [threadsLoading, isCreating, threads.length, createThread]);

  useEffect(() => {
    return () => {
      if (highlightClearTimeoutRef.current) {
        window.clearTimeout(highlightClearTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === "Escape" && normalizedSearchQuery) {
        clearSearch();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSearch, normalizedSearchQuery]);

  useEffect(() => {
    if (!normalizedSearchQuery) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            q: normalizedSearchQuery,
            limit: "20",
            offset: "0",
          });
          const response = await fetch(`/api/search?${params.toString()}`);
          const payload = await response.json().catch((err) => { console.warn('[ChatContainer] failed to parse search response:', err); return null; });

          if (cancelled) return;

          if (!response.ok) {
            const message =
              payload && typeof payload === "object" && "error" in payload
                ? String(payload.error)
                : "Search failed";
            setSearchResults([]);
            setSearchTotal(0);
            setSearchError(message);
            return;
          }

          const data = payload as MessageSearchResponse;
          setSearchResults(Array.isArray(data.results) ? data.results : []);
          setSearchTotal(typeof data.total === "number" ? data.total : 0);
          setSearchError(null);
        } catch (error) {
          if (cancelled) return;
          console.error("Search request failed", error);
          setSearchResults([]);
          setSearchTotal(0);
          setSearchError("Search failed");
        } finally {
          if (!cancelled) {
            setSearchLoading(false);
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [normalizedSearchQuery]);

  const prevActiveThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only stop active streams when actually switching threads, not on initial mount.
    if (prevActiveThreadIdRef.current !== null && prevActiveThreadIdRef.current !== activeThreadId) {
      void handleStopRef.current();
      if (pendingOpenThreadIdRef.current) {
        setOpenThreadId(pendingOpenThreadIdRef.current);
        pendingOpenThreadIdRef.current = null;
      } else {
        setOpenThreadId(null);
      }
    }
    prevActiveThreadIdRef.current = activeThreadId;
    if (!activeThreadId) return;
    void loadHistory(activeThreadId);
    // Load persisted task drafts
    fetch(`/api/task-drafts?threadId=${encodeURIComponent(activeThreadId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.drafts && Object.keys(data.drafts).length > 0) {
          setTaskDraftsRaw(data.drafts as Record<string, TaskDraftMessage>);
        } else {
          setTaskDraftsRaw({});
        }
      })
      .catch((err) => { console.warn('[ChatContainer] load task drafts failed:', err); setTaskDraftsRaw({}); });
  }, [activeThreadId, loadHistory]);

  useEffect(() => {
    if (!activeThreadId) return;
    void updateThreadMessages(activeThreadId, messages);
  }, [activeThreadId, messages, updateThreadMessages]);

  const handleThreadReply = useCallback(
    (
      rootMessageId: string,
      content: string,
      maxRounds: number = 10,
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      if (!activeThreadId) return;
      if (activeParticipants.length === 0) return;
      const orderedActiveIds = orderParticipantIds(
        activeParticipants.map((participant) => participant.id),
        pinnedParticipantId
      );
      void sendMessage(
        content,
        maxRounds,
        activeThreadId,
        rootMessageId,
        undefined,
        undefined,
        orderedActiveIds,
        effectiveProjectSlug,
        promptPrefix,
        routing
      );
    },
    [activeThreadId, sendMessage, activeParticipants, effectiveProjectSlug]
  );


  const handleSummarize = useCallback(async (rootMessageId: string) => {
    if (!activeThreadId) return;
    if (activeParticipants.length === 0) {
      window.alert("Enable at least one agent in this project.");
      return;
    }
    setSummarizingThreads((prev) => new Set(prev).add(rootMessageId));
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeThreadId,
          rootMessageId,
          activeParticipantIds: activeParticipants.map((participant) => participant.id),
        }),
      });
      if (res.ok) {
        await loadHistory(activeThreadId);
      } else {
        console.error("Summarize failed:", await res.text());
      }
    } catch (err) {
      console.error("Summarize error:", err);
    } finally {
      setSummarizingThreads((prev) => {
        const next = new Set(prev);
        next.delete(rootMessageId);
        return next;
      });
    }
  }, [activeThreadId, loadHistory, activeParticipants]);

  const handleExtractTasks = useCallback(async (rootMessageId: string) => {
    if (!activeThreadId) return;
    if (activeParticipants.length === 0) {
      window.alert("Enable at least one agent in this project.");
      return;
    }
    setExtractingTasks((prev) => new Set(prev).add(rootMessageId));
    try {
      const res = await fetch("/api/tasks/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeThreadId,
          rootMessageId,
          activeParticipantIds: activeParticipants.map((participant) => participant.id),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const draft: TaskDraftMessage = {
          draftId: crypto.randomUUID(),
          revision: 0,
          tasks: data.tasks,
          buildStatus: "idle",
        };
        setTaskDrafts((prev) => ({ ...prev, [rootMessageId]: draft }));
      } else {
        console.error("Task extraction failed:", await res.text());
      }
    } catch (err) {
      console.error("Task extraction error:", err);
    } finally {
      setExtractingTasks((prev) => {
        const next = new Set(prev);
        next.delete(rootMessageId);
        return next;
      });
    }
  }, [activeThreadId, activeParticipants]);

  const handleUpdateTaskDraft = useCallback((rootMessageId: string, draft: TaskDraftMessage) => {
    setTaskDrafts((prev) => ({ ...prev, [rootMessageId]: draft }));
  }, []);

  const handleBuildTasks = useCallback(async (rootMessageId: string, draft: TaskDraftMessage, projectId: string, projectName: string) => {
    if (!activeThreadId) return;
    setBuildingDrafts((prev) => new Set(prev).add(draft.draftId));
    setTaskDrafts((prev) => ({
      ...prev,
      [rootMessageId]: { ...draft, buildStatus: "building", projectId, projectName },
    }));
    try {
      const buildId = crypto.randomUUID();
      const result = await buildTasks(
        draft.tasks,
        projectId,
        buildId,
        draft.builtTaskIds,
      );
      const builtTaskIds: Record<string, string> = { ...draft.builtTaskIds };
      let hasFailure = false;
      for (const r of result.results) {
        if (r.status === "created" && r.remoteTaskId) {
          builtTaskIds[r.clientTaskId] = r.remoteTaskId;
        } else {
          hasFailure = true;
        }
      }
      setTaskDrafts((prev) => ({
        ...prev,
        [rootMessageId]: {
          ...prev[rootMessageId],
          buildId,
          buildStatus: hasFailure ? "partial_failure" : "done",
          builtTaskIds,
        },
      }));
    } catch (err) {
      console.error("Build error:", err);
      setTaskDrafts((prev) => ({
        ...prev,
        [rootMessageId]: { ...prev[rootMessageId], buildStatus: "partial_failure" },
      }));
    } finally {
      setBuildingDrafts((prev) => {
        const next = new Set(prev);
        next.delete(draft.draftId);
        return next;
      });
    }
  }, [activeThreadId]);

  const handleCreateTasksCommand = useCallback(() => {
    if (!activeThreadId) return;
    const targetRootId = (() => {
      if (openThreadId) return openThreadId;
      const replyRoots = new Set(
        messages
          .map((message) => message.rootMessageId)
          .filter((rootId): rootId is string => Boolean(rootId))
      );
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!message.rootMessageId && replyRoots.has(message.id)) {
          return message.id;
        }
      }
      return null;
    })();
    if (!targetRootId) {
      console.warn("No thread with replies available to extract tasks from");
      return;
    }
    void handleExtractTasks(targetRootId);
  }, [activeThreadId, handleExtractTasks, messages, openThreadId]);

  const handleReplyToMessage = useCallback((messageId: string) => {
    setOpenThreadId(messageId);
  }, []);

  const handleOpenThread = useCallback((rootMessageId: string) => {
    setOpenThreadId(rootMessageId);
  }, []);

  const handleSearchCommand = useCallback((query?: string) => {
    const normalized = query?.trim() ?? "";
    if (normalized) {
      setSearchQuery(normalized);
    }
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      if (!normalized) {
        searchInputRef.current?.select();
      }
    });
  }, []);

  const handleSummarizeCommand = useCallback(() => {
    if (!activeThreadId) return;

    const targetRootId = (() => {
      if (openThreadId) return openThreadId;
      const replyRoots = new Set(
        messages
          .map((message) => message.rootMessageId)
          .filter((rootId): rootId is string => Boolean(rootId))
      );
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!message.rootMessageId && replyRoots.has(message.id)) {
          return message.id;
        }
      }
      return null;
    })();

    if (!targetRootId) {
      console.warn("No thread with replies available to summarize");
      return;
    }
    void handleSummarize(targetRootId);
  }, [activeThreadId, handleSummarize, messages, openThreadId]);

  const handleSend = useCallback(
    async (
      prompt: string,
      maxRounds: number,
      attachmentIds?: string[],
      attachmentMetas?: import("@/lib/types").Attachment[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      const searchMatch = prompt.match(/^\/search(?:\s+([\s\S]+))?$/i);
      if (searchMatch) {
        handleSearchCommand(searchMatch[1]);
        return;
      }

      if (/^\/summarize(?:\s+[\s\S]+)?$/i.test(prompt)) {
        handleSummarizeCommand();
        return;
      }

      if (/^\/tasks(?:\s+[\s\S]+)?$/i.test(prompt) || /^\/create(?:\s+[\s\S]+)?$/i.test(prompt)) {
        handleCreateTasksCommand();
        return;
      }

      let threadId = activeThreadId;
      if (!threadId) {
        const created = await createThread();
        threadId = created.id;
      }

      const selectedActiveIds = activeParticipants.map((participant) => participant.id);
      if (selectedActiveIds.length === 0) {
        window.alert("Enable at least one agent in this project.");
        return;
      }
      const orderedActiveIds = orderParticipantIds(selectedActiveIds, pinnedParticipantId);

      if (openThreadId) {
        await sendMessage(
          prompt,
          maxRounds,
          threadId,
          openThreadId,
          attachmentIds,
          attachmentMetas,
          orderedActiveIds,
          effectiveProjectSlug,
          promptPrefix,
          routing
        );
        return;
      }

      // Every user message in main chat starts its own thread.
      // The user message ID becomes the rootMessageId — agents reply to it.
      const newRootId = await sendMessage(
        prompt,
        maxRounds,
        threadId,
        null,
        attachmentIds,
        attachmentMetas,
        orderedActiveIds,
        effectiveProjectSlug,
        promptPrefix,
        routing
      );

      // If ship mode was staged on the main composer, activate it for the new thread
      if (pendingAutoMode && newRootId) {
        setPendingAutoMode(false);
        setAutoModeThreads((prev) => { const next = new Set(prev); next.add(newRootId); return next; });
        fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate", rootMessageId: newRootId }),
        }).catch((err) => console.error("Failed to activate schedule for new thread:", err));
      }
    },
    [
      activeThreadId,
      pendingAutoMode,
      createThread,
      handleSearchCommand,
      handleSummarizeCommand,
      openThreadId,
      activeParticipants,
      sendMessage,
      effectiveProjectSlug,
    ]
  );

  // ─── Autonomous mode ─────────────────────────────────────────────────────

  const handleAutoModeChange = useCallback(
    async (enabled: boolean) => {
      const targetRootId = openThreadId;

      // No thread open — just stage the flag for the next new thread
      if (!targetRootId) {
        setPendingAutoMode(enabled);
        return;
      }

      setAutoModeThreads((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(targetRootId); else next.delete(targetRootId);
        return next;
      });

      try {
        await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: enabled ? "activate" : "stop", rootMessageId: targetRootId }),
        });
      } catch (err) {
        console.error("Failed to toggle autonomous schedule:", err);
      }
    },
    [openThreadId],
  );

  const handleSelectSearchResult = useCallback(
    (result: MessageSearchResult) => {
      const targetRootId = result.rootMessageId || result.messageId;
      if (result.threadId !== activeThreadId) {
        pendingOpenThreadIdRef.current = targetRootId;
        selectThread(result.threadId);
      } else {
        setOpenThreadId(targetRootId);
      }
      setHighlightedMessageId(null);
      window.requestAnimationFrame(() => {
        setHighlightedMessageId(result.messageId);
        if (highlightClearTimeoutRef.current) {
          window.clearTimeout(highlightClearTimeoutRef.current);
        }
        highlightClearTimeoutRef.current = window.setTimeout(() => {
          setHighlightedMessageId((current) => (current === result.messageId ? null : current));
        }, 2000);
      });
      clearSearch();
    },
    [activeThreadId, clearSearch, selectThread]
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      handleStop();
      await deleteThread(threadId);
    },
    [deleteThread, handleStop]
  );

  const handleDeleteThreadRoot = useCallback(
    (rootMessageId: string) => {
      if (!activeThreadId || !rootMessageId) return;
      const msg = messages.find((m) => m.id === rootMessageId);
      const preview = msg?.content?.slice(0, 120) || undefined;
      setPendingDelete({ type: "thread", id: rootMessageId, preview });
    },
    [activeThreadId, messages]
  );

  const executeDeleteThreadRoot = useCallback(
    async (rootMessageId: string) => {
      if (!activeThreadId) return;

      setDeletingThreadRootId(rootMessageId);
      handleStopThread(rootMessageId);

      try {
        const params = new URLSearchParams({
          threadId: activeThreadId,
          rootMessageId,
        });
        const response = await fetch(`/api/history?${params.toString()}`, { method: "DELETE" });
        if (!response.ok) {
          console.error("Failed to delete message thread", await response.text());
          return;
        }

        setOpenThreadId((current) => (current === rootMessageId ? null : current));
        setHighlightedMessageId(null);

        const nextMessages = messages.filter(
          (message) => message.id !== rootMessageId && message.rootMessageId !== rootMessageId
        );
        void updateThreadMessages(activeThreadId, nextMessages);
        await loadHistory(activeThreadId);
      } catch (error) {
        console.error("Failed to delete message thread", error);
      } finally {
        setDeletingThreadRootId((current) => (current === rootMessageId ? null : current));
      }
    },
    [activeThreadId, loadHistory, messages, handleStopThread, updateThreadMessages]
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!activeThreadId || !messageId) return;
      const msg = messages.find((m) => m.id === messageId);
      const preview = msg?.content?.slice(0, 120) || undefined;
      setPendingDelete({ type: "message", id: messageId, preview });
    },
    [activeThreadId, messages]
  );

  const executeDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!activeThreadId) return;

      try {
        const params = new URLSearchParams({
          threadId: activeThreadId,
          messageId,
        });
        const response = await fetch(`/api/history?${params.toString()}`, { method: "DELETE" });
        if (!response.ok) {
          console.error("Failed to delete message", await response.text());
          return;
        }

        const nextMessages = messages.filter((m) => m.id !== messageId);
        void updateThreadMessages(activeThreadId, nextMessages);
        await loadHistory(activeThreadId);
      } catch (error) {
        console.error("Failed to delete message", error);
      }
    },
    [activeThreadId, loadHistory, messages, updateThreadMessages]
  );

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.type === "thread") {
      void executeDeleteThreadRoot(pendingDelete.id);
    } else {
      void executeDeleteMessage(pendingDelete.id);
    }
    setPendingDelete(null);
  }, [pendingDelete, executeDeleteThreadRoot, executeDeleteMessage]);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const slashCommands: SlashCommand[] = useMemo(
    () => [
      {
        name: "/search",
        description: "Search messages (usage: /search <query>)",
        aliases: ["find"],
        execute: () => handleSearchCommand(),
      },
      {
        name: "/summarize",
        description: "Summarize current thread or latest thread with replies",
        aliases: ["sum"],
        execute: () => handleSummarizeCommand(),
      },
      {
        name: "/tasks",
        description: "Extract tasks from current thread discussion",
        aliases: ["create"],
        execute: () => handleCreateTasksCommand(),
      },
    ],
    [handleSearchCommand, handleSummarizeCommand, handleCreateTasksCommand]
  );

  // Projects scoped to the current thread
  // Repos from the active project (first thread-scoped project, or matched by projectSlug)
  const activeProjectRepos = useMemo(() => {
    const match = effectiveProjectSlug
      ? threadProjects.find((p) => p.slug === effectiveProjectSlug)
      : threadProjects[0];
    return match?.repos ?? [];
  }, [threadProjects, effectiveProjectSlug]);

  // ── Persisted repo selections per thread ──────────────────────────────────
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
  const repoSelectionLoadedForRef = useRef<string | null>(null);

  // Load saved selections when open discussion changes
  useEffect(() => {
    if (!openThreadId) {
      setSelectedRepoIds(new Set());
      repoSelectionLoadedForRef.current = null;
      return;
    }
    if (repoSelectionLoadedForRef.current === openThreadId) return;
    // Clear immediately so old discussion's selections don't bleed
    setSelectedRepoIds(new Set());
    repoSelectionLoadedForRef.current = openThreadId;
    const rid = openThreadId;
    fetch(`/api/thread-repos?rootMessageId=${encodeURIComponent(rid)}`)
      .then((res) => res.json())
      .then((data: { repoIds?: string[] }) => {
        // Only apply if we're still on the same discussion
        if (repoSelectionLoadedForRef.current !== rid) return;
        if (data.repoIds && data.repoIds.length > 0) {
          setSelectedRepoIds(new Set(data.repoIds));
        }
      })
      .catch((err) => console.warn('[ChatContainer] load thread repos failed:', err));
  }, [openThreadId]);

  const handleRepoSelectionChange = useCallback(
    (next: Set<string>) => {
      setSelectedRepoIds(next);
      if (openThreadId) {
        fetch("/api/thread-repos", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rootMessageId: openThreadId, repoIds: [...next] }),
        }).catch((err) => console.warn('[ChatContainer] save thread repos failed:', err));
      }
    },
    [openThreadId]
  );

  const renderReplyComposer = useCallback(
    (rootMessageId: string) => {
      const threadActivityStatus =
        activeProcesses.some((process) => ["spawning", "running"].includes(process.state) && process.threadId === rootMessageId) ||
        Object.values(streaming).some((entry) => entry.rootMessageId === rootMessageId)
          ? "working"
          : activeChatRuns.some((run) => run.rootMessageId === rootMessageId && run.status === "queued")
            ? "queued"
            : "ready";

      return (
        <Composer
          onSend={(message, maxRounds, _attachmentIds, _attachments, pinnedParticipantId, promptPrefix, routing) =>
            handleThreadReply(rootMessageId, message, maxRounds, pinnedParticipantId, promptPrefix, routing)
          }
          onStop={() => handleStopThread(rootMessageId)}
          loading={threadActivityStatus !== "ready"}
          activityStatus={threadActivityStatus}
          participants={activeParticipants}
          projectGroups={threadProjects}
          projects={projectMentions}
          projectSlug={effectiveProjectSlug}
          messages={messages}
          commands={slashCommands}
          placeholder="Reply — @name to mention, /search, /summarize"
          autoMode={autoMode}
          onAutoModeChange={handleAutoModeChange}
          repos={activeProjectRepos}
          selectedRepoIds={selectedRepoIds}
          onRepoSelectionChange={handleRepoSelectionChange}
        />
      );
    },
    [handleThreadReply, handleStopThread, streaming, activeParticipants, threadProjects, projectMentions, effectiveProjectSlug, slashCommands, messages, autoMode, handleAutoModeChange, activeProcesses, activeChatRuns, activeProjectRepos, selectedRepoIds, handleRepoSelectionChange]
  );

  const toggleWorkspaceSidebar = useCallback(() => {
    setWorkspaceSidebarVisible((prev) => {
      const next = !prev;
      persistSidebarPreference(next);
      return next;
    });
  }, [persistSidebarPreference]);

  const handleWorkspaceSidebarWidthChange = useCallback((w: number) => {
    setWorkspaceSidebarWidth(w);
    persistWorkspaceWidth(w);
  }, []);

  const handleAdd = async (p: Participant) => {
    const res = await fetch("/api/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (res.ok) {
      const added = await res.json();
      setParticipants((prev) => [...prev, added]);
    }
  };

  const handleUpdate = async (p: Participant) => {
    const res = await fetch("/api/participants", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (res.ok) {
      const updated = await res.json();
      setParticipants((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
  };

  const handleRemove = async (id: string) => {
    const res = await fetch(`/api/participants?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setParticipants((prev) => prev.filter((p) => p.id !== id));
      if (activeThreadId) {
        setActiveParticipantIds((prev) => {
          const next = prev.filter((participantId) => participantId !== id);
          persistStoredActiveParticipantIds(activeThreadId, next);
          return next;
        });
      }
    }
  };

  const handleReorderParticipants = async (orderedIds: string[]) => {
    // Optimistic update
    setParticipants((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return orderedIds.map((id) => byId.get(id)).filter((p): p is Participant => !!p);
    });
    await fetch("/api/participants", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
  };

  const handleToggleParticipantActive = useCallback(
    (participantId: string, active: boolean) => {
      setActiveParticipantIds((prev) => {
        const orderedParticipantIds = getOrderedParticipantIds(participants, projects, activeThreadId);
        const availableIds = new Set(orderedParticipantIds);
        if (!availableIds.has(participantId)) {
          return prev;
        }

        const nextSet = new Set(prev);
        if (active) {
          nextSet.add(participantId);
        } else {
          nextSet.delete(participantId);
        }

        const next = orderedParticipantIds.filter((id) => nextSet.has(id));

        if (activeThreadId) {
          persistStoredActiveParticipantIds(activeThreadId, next);
        }

        return next;
      });
    },
    [activeThreadId, participants, projects]
  );

  const handleSelectProject = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;
      // Only change participants if the project belongs to the current thread
      if (activeThreadId && !project.thread_ids?.includes(activeThreadId)) return;
      const agentIds = project.agents.map((a) => a.agent_id);
      setActiveParticipantIds(agentIds);
      if (activeThreadId) {
        persistStoredActiveParticipantIds(activeThreadId, agentIds);
      }
    },
    [projects, activeThreadId]
  );

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const renderThemeToggleButton = () => (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] transition-all hover:border-[var(--app-shell-border-strong)] hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  );

  const mainToolbar = projectSlug ? null : (
    <div
      className="desktop-titlebar border-b border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-4 py-2.5 backdrop-blur-xl md:px-6"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="flex min-w-0 items-center flex-shrink-0">
          {showSidebar && !workspaceSidebarVisible && (
            <button
              type="button"
              onClick={toggleWorkspaceSidebar}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] transition hover:border-[var(--app-shell-border-strong)] hover:text-[var(--foreground)]"
              title="Show sidebar"
              aria-label="Show sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <div className="flex flex-1 justify-center min-w-0">
          <div className="flex w-full max-w-2xl items-center gap-2">
            <div className="relative group/search min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-shell-soft-text)] transition-colors group-focus-within/search:text-[var(--primary)]"
                strokeWidth={2}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") clearSearch();
                }}
                placeholder="Search messages…"
                className="h-9 w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] pl-9 pr-16 text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--app-shell-soft-text)] transition-all hover:border-[var(--app-shell-border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--ring)]"
              />
              {normalizedSearchQuery ? (
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  <span className="text-[11px] font-bold text-[var(--muted-foreground)]">
                    {searchLoading ? "…" : searchTotal}
                  </span>
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="text-[10px] font-bold text-[var(--app-shell-soft-text)] transition-colors hover:text-[var(--app-shell-muted)]"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] px-1.5 py-0.5 font-sans text-[10px] font-bold text-[var(--app-shell-soft-text)]">⌘K</kbd>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!projectSlug && renderThemeToggleButton()}
              {!projectSlug && <StatusIndicator />}
              {openThreadId && (
                <button
                  type="button"
                  onClick={() => setLogsOpen(!logsOpen)}
                  aria-label={logsOpen ? "Hide logs" : `Show logs${logs.length > 0 ? ` (${logs.length})` : ""}`}
                  aria-pressed={logsOpen}
                  title={logsOpen ? "Hide logs" : `Show logs${logs.length > 0 ? ` (${logs.length})` : ""}`}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${logsOpen
                    ? "border-[var(--app-shell-border-strong)] bg-[var(--app-shell-subtle)] text-[var(--foreground)]"
                    : "border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
                    }`}
                >
                  <SquareTerminal className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[var(--app-shell-bg)] text-[var(--foreground)]">
        {showSidebar ? (
          <WorkspaceSidebar
            threads={threads}
            participants={participants}
            activeThreadId={activeThreadId}
            isLoading={threadsLoading}
            isRestoringActiveThread={isRestoringActiveThread}
            isCreating={isCreating}
            deletingThreadId={deletingThreadId}
            renamingThreadId={renamingThreadId}
            onSelectThread={selectThread}
            onCreateThread={createThread}
            onRenameThread={renameThread}
            onDeleteThread={handleDeleteThread}
            activeParticipantIds={activeParticipantIds}
            onToggleParticipantActive={handleToggleParticipantActive}
            visible={workspaceSidebarVisible}
            onToggle={toggleWorkspaceSidebar}
            width={workspaceSidebarWidth}
            onWidthChange={handleWorkspaceSidebarWidthChange}
            projects={projects}
            onCreateProject={createProject}
            onUpdateProject={updateProject}
            onDeleteProject={deleteProject}
            onAddAgentToProject={addAgentToProject}
            onRemoveAgentFromProject={removeAgentFromProject}
            onReorderProjectAgents={reorderProjectAgents}
            onUpdateParticipant={handleUpdate}
            onSelectProject={handleSelectProject}
          />
        ) : null}
        <div className="flex flex-col flex-1 min-w-0 relative">
        {
          isRestoringActiveThread ? (
            <div className="flex-1 flex items-center justify-center px-4 text-sm text-[var(--muted-foreground)]">
              Loading your last project…
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 bg-transparent relative">
              <div className="flex flex-col flex-1 min-w-0">
                {openThreadId ? (
                  <div className="desktop-titlebar border-b border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-4 py-2.5 backdrop-blur-xl md:px-6 transition-colors duration-200 shrink-0">
                    <div className="mx-auto flex max-w-5xl items-center gap-3 min-w-0">
                      <button
                        onClick={() => setOpenThreadId(null)}
                        className="p-1.5 text-[var(--app-shell-muted)] hover:text-[var(--primary)] hover:bg-[var(--app-shell-subtle)] rounded-xl transition-all active:scale-95 flex-shrink-0"
                        title="Back to main feed"
                      >
                        <ChevronLeft size={20} strokeWidth={2.25} />
                      </button>
                      <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h2 className="text-[15px] font-semibold text-[var(--foreground)] tracking-tight leading-tight truncate min-w-0">
                            {activeThreadTitle}
                          </h2>
                          {activeThreadStatus && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border shrink-0"
                              style={{ borderColor: activeThreadStatus.color + "40", color: activeThreadStatus.color }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeThreadStatus.color }} />
                              {activeThreadStatus.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--app-shell-muted)]">
                          <span className="opacity-80">{activeThreadParticipants.length} agents</span>
                          <span className="h-0.5 w-0.5 rounded-full bg-[var(--app-shell-soft-text)]" />
                          <span className="opacity-80">Updated {getTimeAgo(lastThreadUpdate)}</span>
                          {knowledgeStatusText && (
                            <>
                              <span className="h-0.5 w-0.5 rounded-full bg-[var(--app-shell-soft-text)]" />
                              <span className="opacity-80">{knowledgeStatusText}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex -space-x-1.5 flex-shrink-0">
                        {activeThreadParticipants.map((p) => (
                          <img
                            key={p.id}
                            src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${p.id}&backgroundColor=${p.color ? p.color.replace('#', '') : 'e2e8f0'}`}
                            alt={p.name}
                            className="h-7 w-7 rounded-full border-2 border-[var(--app-shell-elevated)] object-cover shadow-sm ring-1 ring-[var(--app-shell-border)]"
                            title={p.name}
                          />
                        ))}
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleLearnFromDiscussion()}
                          disabled={knowledgeButtonDisabled}
                          title={isKnowledgeExtractionRunning ? "Learning is already running for this discussion" : "Learn from this discussion"}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${knowledgeButtonDisabled
                            ? "cursor-wait border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] text-[var(--app-shell-muted)]"
                            : "border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
                            }`}
                        >
                          {knowledgeButtonDisabled ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                          ) : (
                            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                          <span className="hidden sm:inline">{isKnowledgeExtractionRunning ? "Learning..." : "Learn from discussion"}</span>
                        </button>
                        {!projectSlug && renderThemeToggleButton()}
                        {!projectSlug && <StatusIndicator />}
                        <button
                          type="button"
                          onClick={() => setLogsOpen(!logsOpen)}
                          aria-label={logsOpen ? "Hide logs" : `Show logs${logs.length > 0 ? ` (${logs.length})` : ""}`}
                          aria-pressed={logsOpen}
                          title={logsOpen ? "Hide logs" : `Show logs${logs.length > 0 ? ` (${logs.length})` : ""}`}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${logsOpen
                            ? "border-[var(--app-shell-border-strong)] bg-[var(--app-shell-subtle)] text-[var(--foreground)]"
                            : "border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
                            }`}
                        >
                          <SquareTerminal className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : mainToolbar}

                {searchActive ? (
                  <SearchResults
                    query={normalizedSearchQuery}
                    results={searchResults}
                    total={searchTotal}
                    participants={participants}
                    threadTitleById={threadTitleById}
                    isLoading={searchLoading}
                    error={searchError}
                    onSelectResult={handleSelectSearchResult}
                  />
                ) : openThreadId ? (
                  <ThreadView
                    messages={messages}
                    streaming={streaming}
                    participants={participants}
                    rootMessageId={openThreadId}
                    queued={activeChatRuns.some((run) => run.rootMessageId === openThreadId && run.status === "queued")}
                    onClose={() => setOpenThreadId(null)}
                    onCopyThread={handleCopyThread}
                    onAddToChat={handleAddToChat}
                    onDeleteThreadRoot={handleDeleteThreadRoot}
                    onDeleteMessage={handleDeleteMessage}
                    highlightedMessageId={highlightedMessageId || undefined}
                    renderReplyComposer={renderReplyComposer}
                    activeProcesses={activeProcesses.filter(p => ["spawning", "running"].includes(p.state) && p.threadId === openThreadId)}
                  />
                ) : (
                  <MessageList
                    messages={messages}
                    streaming={streaming}
                    participants={participants}
                    onOpenThread={handleOpenThread}
                    onCopyThread={handleCopyThread}
                    onAddToChat={handleAddToChat}
                    onDeleteThreadRoot={handleDeleteThreadRoot}
                    onSummarize={handleSummarize}
                    onCreateTasks={handleExtractTasks}
                    onUpdateTaskDraft={handleUpdateTaskDraft}
                    onBuildTasks={handleBuildTasks}
                    summarizingThreads={summarizingThreads}
                    extractingTasks={extractingTasks}
                    buildingDrafts={buildingDrafts}
                    taskDrafts={taskDrafts}
                    deletingThreadRootId={deletingThreadRootId}
                    highlightedMessageId={highlightedMessageId}
                    shipModeThreads={autoModeThreads}
                    onUpdateMessageThreadStatus={activeThreadId ? (messageId, status) => {
                      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, threadStatus: status } : m));
                      void updateMessageThreadStatus(activeThreadId, messageId, status);
                      void fetch("/api/threads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rootMessageId: messageId, status }) });
                    } : undefined}
                    onUpdateMessageOutcomeNote={activeThreadId ? (messageId, note) => {
                      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, outcomeNote: note } : m));
                      void updateMessageOutcomeNote(activeThreadId, messageId, note);
                      const msg = messages.find((m) => m.id === messageId);
                      void fetch("/api/threads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rootMessageId: messageId, status: msg?.threadStatus ?? null, outcomeNote: note }) });
                    } : undefined}
                  />
                )}
                {!searchActive && !openThreadId && (
                  <Composer
                    onSend={handleSend}
                    onStop={handleStop}
                    loading={loading}
                    activityStatus={composerActivityStatus}
                    participants={activeParticipants}
                    projects={projectMentions}
                    projectGroups={threadProjects}
                    projectSlug={effectiveProjectSlug}
                    messages={messages}
                    commands={slashCommands}
                    pendingThreadInsert={pendingThreadInsert}
                    onClearPendingThread={() => setPendingThreadInsert(null)}
                    autoMode={autoMode}
                    onAutoModeChange={handleAutoModeChange}
                    repos={activeProjectRepos}
                    selectedRepoIds={selectedRepoIds}
                    onRepoSelectionChange={handleRepoSelectionChange}
                  />
                )}
              </div>
            </div>
          )
        }
      </div>
      {initialRootMessageId && (
        <LogPanel logs={logs} participants={participants} onClear={() => void clearLogs(activeThreadId)} open={logsOpen} onToggle={() => setLogsOpen(false)} />
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={pendingDelete?.type === "thread" ? "Delete Discussion" : "Delete Message"}
        message={
          pendingDelete?.type === "thread"
            ? "This will permanently delete this discussion and all of its replies. This action cannot be undone."
            : "This will permanently delete this message. This action cannot be undone."
        }
        preview={pendingDelete?.preview}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

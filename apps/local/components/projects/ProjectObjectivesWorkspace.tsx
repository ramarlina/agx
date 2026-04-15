"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Clock,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  Sparkles,
  X,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { Composer } from "@/components/chat-ui/Composer";
import { Markdown } from "@/components/chat-ui/Markdown";
import { agentAvatarUrl } from "@/components/chat-ui/ParticipantBar";
import RichTextEditor from "@/components/RichTextEditor";
import SearchCombo, { type ComboOption } from "@/components/SearchCombo";
import { ObjectiveScheduledTasksPanel } from "@/components/projects/ObjectiveScheduledTasksPanel";
import { ObjectiveActivityTimeline } from "@/components/projects/ObjectiveActivityTimeline";
import { ObjectiveHealthTrend } from "@/components/projects/ObjectiveHealthTrend";
import { LinearIcon } from "@/components/linear/LinearIcon";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import { threadService } from "@/services/threadService";
import {
  loadObjectiveChatPanelWidth,
  loadObjectiveListPanelWidth,
  persistObjectiveChatPanelWidth,
  persistObjectiveListPanelWidth,
} from "@/state/windowState";
import type { GroupMessage, Participant } from "@/lib/types";
import {
  CURRENT_OBJECTIVE_CHAT_SESSION_VERSION,
  addObjectiveActivity,
  buildObjectiveTimelineActivities,
  createManualObjectiveActivity,
  createProjectObjective,
  generateProjectObjectiveKey,
  readProjectObjectivesWorkspace,
  removeProjectObjective,
  type ProjectObjective,
  type ProjectObjectiveHealth,
  type ProjectObjectiveNote,
  type ProjectObjectiveWorkspaceState,
  upsertProjectObjective,
  writeProjectObjectivesWorkspace,
} from "@/lib/project-objectives";

interface ProjectObjectivesWorkspaceProps {
  projectSlug: string;
}

interface ProjectObjectiveDetailProps extends ProjectObjectivesWorkspaceProps {
  objectiveId: string;
  onObjectiveDeleted?: () => void;
}

interface ObjectiveEditorDraft {
  id?: string;
  title: string;
  teamId: string;
  summary: string;
}

interface ObjectiveTeamDraft {
  teamId: string;
}

type ObjectiveNoteItem = ProjectObjectiveNote;

interface ProjectTeamSummary {
  id: string;
  name: string;
}

interface ProjectAgentSummary {
  agent_id: string;
  routing_order: number;
}

interface ObjectiveLinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  status: string;
  assignee: string | null;
  updatedAt: string;
  labels?: string[];
}

const HEALTH_META: Record<
  ProjectObjectiveHealth,
  { label: string; chipClass: string; toneClass: string }
> = {
  on_track: {
    label: "On track",
    chipClass: "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]",
    toneClass: "text-[var(--status-completed-text)]",
  },
  at_risk: {
    label: "At risk",
    chipClass: "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked-text)]",
    toneClass: "text-[var(--status-blocked-text)]",
  },
  off_track: {
    label: "Off track",
    chipClass: "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-text)]",
    toneClass: "text-[var(--status-failed-text)]",
  },
  done: {
    label: "Done",
    chipClass: "border-[var(--status-in-progress-border)] bg-[var(--status-in-progress-bg)] text-[var(--status-in-progress-text)]",
    toneClass: "text-[var(--status-in-progress-text)]",
  },
};

const OBJECTIVE_CHAT_MIN_WIDTH = 320;
const OBJECTIVE_CHAT_MAX_WIDTH = 1200;
const OBJECTIVE_CHAT_DEFAULT_WIDTH = 800;

function ObjectiveChatResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const { isTouchLayout } = useInputCapabilities();

  if (isTouchLayout) {
    return null;
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize objective chat panel"
      className="group relative z-10 hidden w-0 shrink-0 cursor-col-resize xl:block"
      onMouseDown={(event) => {
        event.preventDefault();
        let lastX = event.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const onMouseMove = (ev: MouseEvent) => {
          const delta = lastX - ev.clientX;
          lastX = ev.clientX;
          onResize(delta);
        };
        const onMouseUp = () => {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }}
    >
      <div className="absolute inset-y-0 -left-0.5 w-1 transition-colors group-hover:bg-[var(--primary)]/40" />
    </div>
  );
}

function formatDateTime(value: string | number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildEmptyObjectiveDraft(): ObjectiveEditorDraft {
  return {
    title: "",
    teamId: "",
    summary: "",
  };
}

function buildObjectiveDraft(objective: ProjectObjective): ObjectiveEditorDraft {
  return {
    id: objective.id,
    title: objective.title,
    teamId: objective.teamId,
    summary: objective.summary,
  };
}

function buildObjectiveHref(projectSlug: string, objectiveId: string): string {
  return `/projects/${projectSlug}/objectives/${encodeURIComponent(objectiveId)}`;
}

function formatActivityCount(count: number): string {
  return count === 1 ? "1 activity" : `${count} activities`;
}

function buildActivityMeta(count: number, lastActivityAt: string | null): string {
  const activityLabel = formatActivityCount(count);
  if (!lastActivityAt) {
    return `${activityLabel} · No activity yet`;
  }
  return `${activityLabel} · Last ${formatDateTime(lastActivityAt)}`;
}


function getTeamName(teams: ProjectTeamSummary[], teamId: string): string | null {
  return teams.find((team) => team.id === teamId)?.name ?? null;
}

function prependObjectiveLabelToPrompt(
  objective: Pick<ProjectObjective, "key">,
  prompt: string
): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return trimmedPrompt;

  const objectiveLabelLine = `Objective label: ${objective.key}`;
  if (trimmedPrompt.toLowerCase().includes(objectiveLabelLine.toLowerCase())) {
    return trimmedPrompt;
  }

  const activityInstruction = [
    `Write your output as an activity file at ~/.agx/projects/<project>/objectives/${objective.key}/activities/<timestamp>-<slug>.md`,
    `The file must have YAML frontmatter with: id (unique), source (your task ID), objectiveLabel: "${objective.key}", createdAt (ISO), type (one of: metric-check, status-update, milestone, note).`,
    `The markdown body below the frontmatter contains your output.`,
  ].join("\n");

  return [
    objectiveLabelLine,
    activityInstruction,
    trimmedPrompt,
  ].join("\n\n");
}

function useProjectObjectivesWorkspace(projectSlug: string) {
  const { projects, isLoading, refetch, updateProject } = useProjects();
  const [teams, setTeams] = useState<ProjectTeamSummary[]>([]);
  const project = useMemo(
    () => projects.find((entry) => entry.slug === projectSlug) ?? null,
    [projectSlug, projects]
  );
  const workspace = useMemo(
    () => readProjectObjectivesWorkspace(project?.metadata),
    [project?.metadata]
  );

  const persistWorkspace = useCallback(
    async (nextWorkspace: ProjectObjectiveWorkspaceState) => {
      if (!project) {
        throw new Error("Project not found.");
      }

      await updateProject(project.id, {
        metadata: writeProjectObjectivesWorkspace(project.metadata ?? {}, nextWorkspace),
      });
    },
    [project, updateProject]
  );

  useEffect(() => {
    let isActive = true;

    async function fetchTeams() {
      if (!project?.id) {
        setTeams([]);
        return;
      }

      try {
        const response = await fetch(`/api/projects/${project.id}/teams`);
        if (!response.ok) {
          throw new Error("Failed to fetch teams");
        }
        const payload = (await response.json()) as {
          teams?: Array<{ id?: string; name?: string }>;
        };
        if (!isActive) return;
        setTeams(
          (payload.teams ?? [])
            .map((team) => ({
              id: typeof team.id === "string" ? team.id : "",
              name: typeof team.name === "string" ? team.name : "Untitled team",
            }))
            .filter((team) => team.id)
        );
      } catch {
        if (!isActive) return;
        setTeams([]);
      }
    }

    void fetchTeams();

    return () => {
      isActive = false;
    };
  }, [project?.id]);

  return {
    isLoading,
    project,
    workspace,
    teams,
    persistWorkspace,
    refetchProject: refetch,
  };
}

function buildObjectiveChatPrefix(
  objective: ProjectObjective,
  teamName: string | null,
  projectId: string,
  projectSlug: string,
  appOrigin: string | null
): string {
  const basePath = `/api/projects/${projectId}/objectives/${objective.id}`;
  const objectiveRoute = appOrigin ? `${appOrigin}${basePath}` : basePath;
  const scheduledTasksRoute = `${objectiveRoute}/scheduled-tasks`;
  const linearIssuesRoute = `${objectiveRoute}/linear-issues`;
  const notesRoute = `${objectiveRoute}/notes`;

  const objectiveFilePath = `~/.agx/projects/${projectSlug}/objectives/${objective.key}.md`;
  const notesDir = `~/.agx/projects/${projectSlug}/objectives/${objective.key}/notes/`;
  const validateRoute = `${objectiveRoute}/validate`;

  const notesPreview = objective.notes?.length
    ? objective.notes.map((n) => `- **${n.title}**: ${n.body.slice(0, 120)}${n.body.length > 120 ? "..." : ""}`).join("\n")
    : null;

  return [
    "You are working inside a strategy session for this project objective.",
    `Project slug: ${projectSlug}`,
    `Objective: ${objective.title}`,
    `Objective label: ${objective.key}`,
    teamName ? `Owning team: ${teamName}` : "",
    notesPreview ? `Current notes:\n${notesPreview}` : "Current notes: none yet.",
    "Wake schedule: managed by the built-in objective worker job.",

    `## Objective file (source of truth)\n\nThis objective is stored as a frontmatter markdown file at:\n\`${objectiveFilePath}\`\n\nFile format:\n- YAML frontmatter between \`---\` delimiters contains all metadata (title, teamId, key, status, progress, scheduledTaskIds, threadId, chatSessionVersion, createdAt, updatedAt).\n- \`## Activities\` section contains the activity timeline; each activity is a \`### Title\` block with metadata lines (\`- **id:**\`, \`- **source:**\`, \`- **created:**\`, \`- **body:**\`) and optional \`#### Replies\` sub-section.\n\nNotes are stored as separate files in \`${notesDir}\`. Each note is a markdown file with YAML frontmatter (id, title, objectiveId, createdAt, updatedAt) and a markdown body.\n\nWhen updating the objective, you can edit this file directly. Rules:\n- NEVER remove or break the \`---\` frontmatter delimiters.\n- NEVER change the \`id\` or \`createdAt\` fields.\n- Always update \`updatedAt\` to the current ISO timestamp when making changes.\n- After any edit, call \`GET ${validateRoute}\` to verify the file is still valid.\n- If validation fails, fix the errors immediately before doing anything else.`,

    "Scheduled tasks live in the shared scheduled-task list and are filtered by this objective label.",
    "Your job is to help the team develop the strategy needed to reach the goal, including the right combination of objective notes, scheduled tasks, and Linear tickets.",
    "Use the current session history to build on prior reasoning. Only reset and start from scratch when the user explicitly starts a new session.",
    "Use this thread to pressure-test strategy, suggest better tactics, rewrite the objective when asked, propose the right operational cadence, and take concrete follow-up actions when the user wants them applied.",
    "When suggesting edits, prefer editing the frontmatter file directly or using the notes API. When the user asks you to make a change, edit the file, validate, then confirm.",
    "Local objective APIs:",
    `- PATCH ${objectiveRoute} with JSON fields such as {"title","teamId","key"} to update the objective itself.`,
    `- GET ${notesRoute} to list all notes for this objective. Returns {"notes":[...],"total","page","limit","hasMore"}.`,
    `- POST ${notesRoute} with {"title","body"} to create a new note.`,
    `- GET ${notesRoute}/{noteId} to read a single note.`,
    `- PATCH ${notesRoute}/{noteId} with {"title","body"} to update a note.`,
    `- DELETE ${notesRoute}/{noteId} to delete a note.`,
    `- GET ${scheduledTasksRoute} to inspect the scheduled tasks already tracked for this objective.`,
    `- POST ${scheduledTasksRoute} with {"name","prompt","cadence","agentId"} to create a scheduled task for this objective.`,
    `- GET ${linearIssuesRoute} to inspect Linear tickets carrying the objective label "${objective.key}".`,
    `- POST ${linearIssuesRoute} with {"title","description","teamId","assigneeId","cycleId","stateId","priority"} to create a Linear ticket labeled "${objective.key}".`,
    `- GET ${validateRoute} to validate the objective file on disk. Returns {"valid":true} or {"valid":false,"errors":[...]}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface ObjectiveChatSession {
  rootMessageId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  messages: GroupMessage[];
}

type ObjectiveChatView = "list" | "detail";

type ObjectiveDetailTab = "activity" | "notes" | "linear" | "scheduled-tasks";

function summarizeSessionTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled session";
  return normalized.length > 56 ? `${normalized.slice(0, 56).trim()}...` : normalized;
}

function formatMessageCount(count: number): string {
  return count === 1 ? "1 message" : `${count} messages`;
}

function isObjectiveChatRootMessage(message: GroupMessage): boolean {
  return message.role === "user" && !message.rootMessageId;
}

interface ObjectiveChatMigrationResult {
  messages: GroupMessage[];
  primaryRootMessageId: string;
  mergedRootMessageIds: string[];
}

function buildLegacyObjectiveChatMigration(
  messages: GroupMessage[]
): ObjectiveChatMigrationResult | null {
  const roots = messages
    .filter(isObjectiveChatRootMessage)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (roots.length <= 1) {
    return null;
  }

  const primaryRootMessageId = roots[0]?.id;
  if (!primaryRootMessageId) {
    return null;
  }

  const mergedRootMessageIds = roots.slice(1).map((message) => message.id);
  const mergedRootIdSet = new Set(mergedRootMessageIds);
  const migratedMessages = [...messages]
    .map((message) => {
      const isMergedRoot = mergedRootIdSet.has(message.id) && isObjectiveChatRootMessage(message);
      const belongsToMergedRoot =
        typeof message.rootMessageId === "string" && mergedRootIdSet.has(message.rootMessageId);

      if (!isMergedRoot && !belongsToMergedRoot) {
        return message;
      }

      return {
        ...message,
        rootMessageId: primaryRootMessageId,
        parentMessageId: primaryRootMessageId,
        depth: 1,
      };
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  return {
    messages: migratedMessages,
    primaryRootMessageId,
    mergedRootMessageIds,
  };
}

function buildObjectiveChatSessions(messages: GroupMessage[]): ObjectiveChatSession[] {
  const roots = messages
    .filter(isObjectiveChatRootMessage)
    .sort((left, right) => right.timestamp - left.timestamp);

  return roots.map((rootMessage) => {
    const replies = messages
      .filter((message) => message.rootMessageId === rootMessage.id)
      .sort((left, right) => left.timestamp - right.timestamp);
    const sessionMessages = [rootMessage, ...replies];
    const lastMessage = sessionMessages[sessionMessages.length - 1] ?? rootMessage;

    return {
      rootMessageId: rootMessage.id,
      title: summarizeSessionTitle(rootMessage.content),
      updatedAt: lastMessage.timestamp,
      messageCount: sessionMessages.length,
      messages: sessionMessages,
    };
  });
}

function ObjectiveChatPanel({
  projectId,
  projectSlug,
  objective,
  teamName,
  onThreadLinked,
  onObjectiveUpdated,
}: {
  projectId: string;
  projectSlug: string;
  objective: ProjectObjective;
  teamName: string | null;
  onThreadLinked: (threadId: string) => Promise<void>;
  onObjectiveUpdated: () => Promise<void>;
}) {
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    const storedWidth = loadObjectiveChatPanelWidth();
    return storedWidth || OBJECTIVE_CHAT_DEFAULT_WIDTH;
  });
  const [threadId, setThreadId] = useState<string | null>(
    objective.threadId ?? (objective.id ? `objective-chat:${objective.id}` : null)
  );
  const [chatView, setChatView] = useState<ObjectiveChatView>("list");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatSessionVersion, setChatSessionVersion] = useState(objective.chatSessionVersion);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const wasWorkingRef = useRef(false);
  const legacyChatMigrationAttemptedRef = useRef(false);
  const appOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : null;
  const {
    messages,
    setMessages,
    sendMessage,
    loadHistory,
    setChatRuns,
    stop,
    chatRuns,
  } = useGroupChat(threadId);
  const {
    processes,
    streaming,
    chatRuns: polledChatRuns,
    poll,
  } = useProcessPolling(
    threadId ? { workspaceId: threadId } : null,
    { messages, setMessages }
  );

  useEffect(() => {
    if (objective.threadId && objective.threadId !== threadId) {
      setThreadId(objective.threadId);
    }
  }, [objective.threadId, threadId]);

  useEffect(() => {
    setChatView("list");
    setSelectedSessionId(null);
    setHistoryLoaded(false);
    legacyChatMigrationAttemptedRef.current = false;
  }, [objective.id]);

  useEffect(() => {
    setChatSessionVersion(objective.chatSessionVersion);
    if (objective.chatSessionVersion >= CURRENT_OBJECTIVE_CHAT_SESSION_VERSION) {
      legacyChatMigrationAttemptedRef.current = true;
    }
  }, [objective.chatSessionVersion]);

  const linkThreadToProject = useCallback(
    async (nextThreadId: string) => {
      const normalizedThreadId = nextThreadId.trim();
      if (!normalizedThreadId) return;

      const response = await fetch(`/api/projects/${projectId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: normalizedThreadId }),
      });

      if (!response.ok) {
        throw new Error("Failed to link objective chat to the project.");
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;

    if (!threadId) {
      setHistoryLoaded(true);
      return;
    }

    setHistoryLoaded(false);

    void (async () => {
      await loadHistory(threadId);
      if (!cancelled) {
        setHistoryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadHistory, threadId]);

  useEffect(() => {
    let cancelled = false;

    async function loadParticipants() {
      try {
        const agentsUrl = objective.teamId
          ? `/api/projects/${projectId}/teams/${objective.teamId}/agents`
          : `/api/projects/${projectId}/agents`;
        const [participantsResponse, agentsResponse] = await Promise.all([
          fetch("/api/participants"),
          fetch(agentsUrl),
        ]);
        const rawParticipants = participantsResponse.ok
          ? await participantsResponse.json()
          : [];
        const allParticipants = Array.isArray(rawParticipants) ? (rawParticipants as Participant[]) : [];
        const rawAgents = agentsResponse.ok
          ? await agentsResponse.json()
          : { agents: [] };
        const agentsPayload =
          rawAgents && typeof rawAgents === "object"
            ? (rawAgents as { agents?: ProjectAgentSummary[] })
            : { agents: [] };
        if (cancelled) return;

        const orderedAgentIds = (agentsPayload.agents ?? [])
          .slice()
          .sort((left, right) => left.routing_order - right.routing_order)
          .map((agent) => agent.agent_id);
        if (orderedAgentIds.length === 0) {
          setParticipants(allParticipants);
          return;
        }

        const participantById = new Map(allParticipants.map((participant) => [participant.id, participant]));
        setParticipants(
          orderedAgentIds
            .map((agentId) => participantById.get(agentId))
            .filter((participant): participant is Participant => Boolean(participant))
        );
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load objective chat participants", error);
        setParticipants([]);
      }
    }

    void loadParticipants();

    return () => {
      cancelled = true;
    };
  }, [projectId, objective.teamId]);

  useEffect(() => {
    if (!objective.threadId) {
      return;
    }

    void linkThreadToProject(objective.threadId).catch((error) => {
      console.warn("Failed to re-link objective chat thread to project", error);
    });
  }, [linkThreadToProject, objective.threadId]);

  useEffect(() => {
    if (!objective.threadId || !threadId || !historyLoaded) {
      return;
    }
    if (chatSessionVersion >= CURRENT_OBJECTIVE_CHAT_SESSION_VERSION) {
      return;
    }
    if (legacyChatMigrationAttemptedRef.current) {
      return;
    }

    legacyChatMigrationAttemptedRef.current = true;
    const migration = buildLegacyObjectiveChatMigration(messages);
    let cancelled = false;

    void (async () => {
      setChatError(null);

      try {
        if (migration) {
          const historyResponse = await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId,
              messages: migration.messages,
            }),
          });

          if (!historyResponse.ok) {
            throw new Error("Failed to migrate the objective chat history.");
          }

          if (cancelled) {
            return;
          }

          setMessages(migration.messages);
          setSelectedSessionId((currentSessionId) =>
            currentSessionId && migration.mergedRootMessageIds.includes(currentSessionId)
              ? migration.primaryRootMessageId
              : currentSessionId
          );
        }

        const objectiveResponse = await fetch(
          `/api/projects/${projectId}/objectives/${objective.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatSessionVersion: CURRENT_OBJECTIVE_CHAT_SESSION_VERSION,
            }),
          }
        );

        if (!objectiveResponse.ok) {
          throw new Error("Failed to update the objective chat session version.");
        }

        if (cancelled) {
          return;
        }

        setChatSessionVersion(CURRENT_OBJECTIVE_CHAT_SESSION_VERSION);
        void onObjectiveUpdated().catch((error) => {
          console.warn("Failed to refresh objective after objective chat migration", error);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.warn("Failed to migrate legacy objective chat sessions", error);
        setChatError(
          error instanceof Error
            ? error.message
            : "Failed to migrate the objective chat history."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    chatSessionVersion,
    historyLoaded,
    messages,
    objective.id,
    objective.threadId,
    onObjectiveUpdated,
    projectId,
    setMessages,
    threadId,
  ]);

  const ensureObjectiveThread = useCallback(async (): Promise<string | null> => {
    if (objective.threadId) {
      return objective.threadId;
    }

    const desiredThreadId =
      threadId ?? (objective.id ? `objective-chat:${objective.id}` : null);
    if (!desiredThreadId) {
      return null;
    }

    setChatError(null);

    try {
      const createdThread = await threadService.createThread({
        id: desiredThreadId,
        title: objective.title,
        metadata: {
          scope: "objective",
          objectiveId: objective.id,
          projectId,
          projectSlug,
        },
      });
      setThreadId(createdThread.id);
      await linkThreadToProject(createdThread.id);
      await onThreadLinked(createdThread.id);
      return createdThread.id;
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Failed to create the objective chat."
      );
      return null;
    }
  }, [
    linkThreadToProject,
    objective.id,
    objective.threadId,
    objective.title,
    onThreadLinked,
    projectId,
    projectSlug,
    threadId,
  ]);

  const participantMap = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants]
  );
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
        if (polledChatRuns.some((polledRun) => polledRun.chatRunId === run.chatRunId)) {
          return true;
        }
        return now - (run.enqueuedAt ?? 0) <= 5000;
      });

      return next.sort((left, right) =>
        String(left.chatRunId || "").localeCompare(String(right.chatRunId || ""))
      );
    });
  }, [polledChatRuns, setChatRuns]);

  const activeChatRuns = useMemo(() => {
    const now = Date.now();
    const byId = new Map(polledChatRuns.map((run) => [run.chatRunId, run]));

    for (const run of chatRuns) {
      if (!run.optimistic || byId.has(run.chatRunId)) continue;
      if (now - (run.enqueuedAt ?? 0) > 5000) continue;
      byId.set(run.chatRunId, run);
    }

    return Array.from(byId.values()).filter(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "awaiting_user" ||
        run.status === "blocked"
    );
  }, [chatRuns, polledChatRuns]);
  const sessions = useMemo(() => buildObjectiveChatSessions(messages), [messages]);
  const selectedSession = useMemo(
    () =>
      selectedSessionId
        ? sessions.find((session) => session.rootMessageId === selectedSessionId) ?? null
        : null,
    [selectedSessionId, sessions]
  );
  const isDetailView = chatView === "detail" && Boolean(selectedSessionId);
  const activeRunStatuses = new Set(["queued", "running", "awaiting_user", "blocked"]);
  const hasWorkspaceWork =
    activeChatRuns.length > 0 ||
    processes.some((process) => process.state === "spawning" || process.state === "running");
  const activeSessionStateById = useMemo(() => {
    const stateById = new Map<string, "queued" | "working">();

    for (const entry of activeChatRuns) {
      if (!entry.rootMessageId) continue;
      if (!activeRunStatuses.has(entry.status)) continue;
      const nextState = entry.status === "queued" ? "queued" : "working";
      const currentState = stateById.get(entry.rootMessageId);
      if (currentState === "working") continue;
      stateById.set(entry.rootMessageId, nextState);
    }

    for (const process of processes) {
      if (!process.threadId) continue;
      if (process.state !== "spawning" && process.state !== "running") continue;
      stateById.set(process.threadId, "working");
    }

    return stateById;
  }, [activeChatRuns, processes]);
  const workspaceActivityStatus: "ready" | "queued" | "working" = useMemo(() => {
    if (processes.some((process) => process.state === "spawning" || process.state === "running")) {
      return "working";
    }
    if (
      activeChatRuns.some(
        (entry) => activeRunStatuses.has(entry.status) && entry.status !== "queued"
      )
    ) {
      return "working";
    }
    if (activeChatRuns.some((entry) => entry.status === "queued")) {
      return "queued";
    }
    return "ready";
  }, [activeChatRuns, activeRunStatuses, processes]);
  useEffect(() => {
    if (wasWorkingRef.current && !hasWorkspaceWork) {
      void onObjectiveUpdated().catch((error) => {
        console.warn("Failed to refresh objective after objective chat activity", error);
      });
    }
    wasWorkingRef.current = hasWorkspaceWork;
  }, [hasWorkspaceWork, onObjectiveUpdated]);

  const cancelChatRun = useCallback(async (chatRunId: string) => {
    await fetch(`/api/chat-runs/${encodeURIComponent(chatRunId)}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "cancel", reason: "Interrupted by a new objective chat message" }),
    }).catch((error) => {
      console.warn("Failed to cancel objective chat run", error);
    });
  }, []);

  const interruptObjectiveChat = useCallback(async () => {
    const activeRunIds = Array.from(
      new Set(
        activeChatRuns
          .map((run) => run.chatRunId)
          .filter((chatRunId): chatRunId is string => Boolean(chatRunId))
      )
    );

    await Promise.all(activeRunIds.map((chatRunId) => cancelChatRun(chatRunId)));
    await stop();
    await poll();
  }, [activeChatRuns, cancelChatRun, poll, stop]);

  const handleSend = useCallback(
    async (
      message: string,
      maxRounds: number,
      attachmentIds?: string[],
      attachments?: import("@/lib/types").Attachment[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: import("@/lib/chat/composer-routing").ComposerRoutingMetadata
    ) => {
      if (hasWorkspaceWork) {
        await interruptObjectiveChat();
      }

      setChatError(null);
      const ensuredThreadId = await ensureObjectiveThread();
      if (!ensuredThreadId) return;
      const projectParticipantIds = participants.map((participant) => participant.id);
      const rootMessageId = isDetailView ? selectedSessionId : null;
      const combinedPrefix = [
        buildObjectiveChatPrefix(objective, teamName, projectId, projectSlug, appOrigin),
        promptPrefix,
      ]
        .filter(Boolean)
        .join("\n\n");

      const sentMessageId = await sendMessage(
        message,
        maxRounds,
        ensuredThreadId,
        rootMessageId,
        attachmentIds,
        attachments,
        pinnedParticipantId ? [pinnedParticipantId] : projectParticipantIds,
        projectSlug,
        combinedPrefix,
        routing
      );

      if (!rootMessageId && sentMessageId) {
        setSelectedSessionId(sentMessageId);
        setChatView("detail");
      }
    },
    [
      appOrigin,
      ensureObjectiveThread,
      hasWorkspaceWork,
      interruptObjectiveChat,
      isDetailView,
      objective,
      participants,
      projectId,
      projectSlug,
      selectedSessionId,
      sendMessage,
      teamName,
    ]
  );

  const visibleMessages = useMemo(
    () => (isDetailView ? selectedSession?.messages ?? [] : []),
    [isDetailView, selectedSession]
  );
  const visibleStreamingEntries = useMemo(
    () =>
      isDetailView && selectedSessionId
        ? Object.entries(streaming).filter(([, entry]) => entry.rootMessageId === selectedSessionId)
        : [],
    [isDetailView, selectedSessionId, streaming]
  );

  const handleChatPanelResize = useCallback((delta: number) => {
    setChatPanelWidth((currentWidth) => {
      const nextWidth = Math.max(
        OBJECTIVE_CHAT_MIN_WIDTH,
        Math.min(OBJECTIVE_CHAT_MAX_WIDTH, currentWidth + delta)
      );
      persistObjectiveChatPanelWidth(nextWidth);
      return nextWidth;
    });
  }, []);

  return (
    <>
      <ObjectiveChatResizeHandle onResize={handleChatPanelResize} />
      <aside
        className="relative flex h-full min-h-[420px] w-full flex-col overflow-hidden border-t border-[var(--border)] bg-[var(--overlay-panel)] xl:min-h-0 xl:w-[var(--objective-chat-panel-width)] xl:shrink-0 xl:self-stretch xl:border-l xl:border-t-0"
        style={
          {
            "--objective-chat-panel-width": `${chatPanelWidth}px`,
          } as CSSProperties
        }
      >
        <ErrorBanner message={chatError} />

        {isDetailView ? (
          <div className="border-b border-[var(--border)] px-4 py-4">
            <button
              type="button"
              onClick={() => setChatView("list")}
              aria-label="Back to sessions"
              className="inline-flex min-w-0 items-center gap-2 text-left text-sm font-medium text-[var(--foreground)] transition-colors hover:text-[var(--primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="truncate">
                {selectedSession?.title ?? "Loading session..."}
              </span>
            </button>
          </div>
        ) : (
          <div className="border-b border-[var(--border)] px-4 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Strategy Sessions
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Start a new strategy conversation below, or open an earlier session to keep
                building on it.
              </p>
            </div>
          </div>
        )}

        <div
          className={`min-h-0 flex-1 overflow-y-auto pb-[calc(15rem+env(safe-area-inset-bottom))] ${
            isDetailView ? "px-4 py-4" : "px-0 py-0"
          }`}
        >
          {!isDetailView ? (
            sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[var(--muted-foreground)]">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  No strategy sessions yet
                </p>
                <p className="max-w-sm text-xs">
                  Use the composer below to start the first conversation about how this
                  objective should be reached.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {sessions.map((session) => {
                  const sessionState = activeSessionStateById.get(session.rootMessageId) ?? null;
                  return (
                    <button
                      key={session.rootMessageId}
                      type="button"
                      onClick={() => {
                        setSelectedSessionId(session.rootMessageId);
                        setChatView("detail");
                      }}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--overlay-panel-soft)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {session.title}
                        </p>
                        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                          {formatMessageCount(session.messageCount)} · Last{" "}
                          {formatDateTime(session.updatedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {sessionState ? (
                          <span className="rounded-full border border-[var(--status-in-progress-border)] bg-[var(--status-in-progress-bg)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--status-in-progress-text)]">
                            {sessionState === "queued" ? "Queued" : "Working"}
                          </span>
                        ) : null}
                        <ArrowRight className="mt-0.5 h-4 w-4 text-[var(--muted-foreground)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : visibleMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[var(--muted-foreground)]">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Loading strategy session
              </p>
              <p className="max-w-sm text-xs">
                The conversation will appear here once the session history is ready.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleMessages.map((message) => {
                const participant = message.participantId
                  ? participantMap.get(message.participantId)
                  : null;
                return (
                  <div key={message.id} className="flex gap-3">
                    {message.role === "user" ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--overlay-panel-soft)] text-[var(--muted-foreground)]">
                        <User className="h-4 w-4" />
                      </div>
                    ) : (
                      <img
                        src={agentAvatarUrl(message.participantId ?? "assistant", 32, participant?.color)}
                        alt={participant?.name ?? "Agent"}
                        className="h-8 w-8 shrink-0 rounded-full border border-[var(--border)] object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--foreground)]">
                          {message.role === "user" ? "You" : participant?.name ?? "Agent"}
                        </span>
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          {new Date(message.timestamp).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[var(--overlay-panel-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
                        <Markdown content={message.content} isUser={message.role === "user"} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleStreamingEntries.map(([participantId]) => {
                const participant = participantMap.get(participantId);
                return (
                  <div key={`stream-${participantId}`} className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
                    <img
                      src={agentAvatarUrl(participantId, 32, participant?.color)}
                      alt={participant?.name ?? "Agent"}
                      className="h-8 w-8 shrink-0 rounded-full border border-[var(--border)] object-cover"
                    />
                    <span>{participant?.name ?? "Agent"} is thinking...</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-[var(--overlay-panel)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Composer
            onSend={handleSend}
            onStop={interruptObjectiveChat}
            participants={participants}
            commands={[]}
            projectId={projectId}
            projectSlug={projectSlug}
            loading={workspaceActivityStatus !== "ready"}
            activityStatus={workspaceActivityStatus}
            sendInterruptsBusy
            placeholder={
              isDetailView
                ? `Continue strategy for "${objective.title}"...`
                : `Start a new strategy session for "${objective.title}"...`
            }
            initialPinnedParticipantId={participants[0]?.id}
          />
        </div>
      </aside>
    </>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
      {label}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
      <AlertTriangle className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

function ObjectiveNotesEditor({
  content,
  editable = false,
  onChange,
  placeholder,
}: {
  content: string;
  editable?: boolean;
  onChange?: (markdown: string) => void;
  placeholder?: string;
}) {
  const hasContent = content.trim().length > 0;
  if (!editable && !hasContent) return null;

  return (
    <div className="overflow-hidden border-l-2 border-[var(--border)]/60 pl-4 transition-all focus-within:border-indigo-500/60">
      {editable || hasContent ? (
        <RichTextEditor
          content={content}
          editable={editable}
          onChange={onChange}
          placeholder={placeholder}
        />
      ) : null}
    </div>
  );
}

const OBJECTIVE_LIST_MIN_WIDTH = 240;
const OBJECTIVE_LIST_MAX_WIDTH = 480;

function ObjectiveListResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const { isTouchLayout } = useInputCapabilities();

  if (isTouchLayout) {
    return null;
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize objective list panel"
      className="group relative z-10 w-0 shrink-0 cursor-col-resize"
      onMouseDown={(event) => {
        event.preventDefault();
        let lastX = event.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const onMouseMove = (ev: MouseEvent) => {
          const delta = ev.clientX - lastX;
          lastX = ev.clientX;
          onResize(delta);
        };
        const onMouseUp = () => {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }}
    >
      <div className="absolute inset-y-0 -left-0.5 w-1 transition-colors group-hover:bg-[var(--primary)]/40" />
    </div>
  );
}

function ObjectiveListCard({
  objective,
  activityCount,
  lastActivityAt,
  activeAgentIds,
  participants,
  isSelected,
  onSelect,
}: {
  objective: ProjectObjective;
  activityCount: number;
  lastActivityAt: string | null;
  activeAgentIds?: string[];
  participants?: Participant[];
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const activityMeta = buildActivityMeta(activityCount, lastActivityAt);

  return (
    <article className="px-2">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open details for ${objective.title}`}
        className={`group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
          isSelected
            ? "bg-[var(--primary)]/10 border border-[var(--primary)]/20"
            : "border border-transparent hover:bg-[var(--secondary)]"
        }`}
      >
        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`rounded-full border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-[0.12em] ${HEALTH_META[objective.status].chipClass}`}
            >
              {HEALTH_META[objective.status].label}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">
            {objective.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {activityMeta}
          </p>
        </div>

        {activeAgentIds && activeAgentIds.length > 0 && (
          <span className="inline-flex items-center -space-x-1 shrink-0">
            {activeAgentIds.slice(0, 3).map((agentId) => {
              const participant = participants?.find((p) => p.id === agentId);
              return (
                <span key={agentId} className="relative inline-block" title={participant?.name ?? agentId}>
                  <img src={agentAvatarUrl(agentId, 16, participant?.color ?? undefined)} alt={participant?.name ?? agentId} className="h-3 w-3 rounded-full ring-[1.5px] ring-[var(--background)]" />
                  <span className="absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full bg-green-500 ring-[1px] ring-[var(--background)]" />
                </span>
              );
            })}
          </span>
        )}
      </button>
    </article>
  );
}

export function ProjectObjectivesOverview({
  projectSlug,
  initialObjectiveId,
}: ProjectObjectivesWorkspaceProps & { initialObjectiveId?: string }) {
  const { isLoading, project, workspace, teams, persistWorkspace } =
    useProjectObjectivesWorkspace(projectSlug);
  const objectives = workspace.objectives;
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(
    initialObjectiveId ?? null
  );
  const [listPanelWidth, setListPanelWidth] = useState(() => {
    return loadObjectiveListPanelWidth() || 320;
  });
  const [objectiveEditor, setObjectiveEditor] = useState<ObjectiveEditorDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeAgentsByObjective, setActiveAgentsByObjective] = useState<Map<string, string[]>>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Auto-select first objective when none is selected
  useEffect(() => {
    if (!selectedObjectiveId && objectives.length > 0) {
      setSelectedObjectiveId(objectives[0].id);
    }
  }, [selectedObjectiveId, objectives]);

  // Clear selection if the selected objective was deleted
  useEffect(() => {
    if (
      selectedObjectiveId &&
      objectives.length > 0 &&
      !objectives.some((o) => o.id === selectedObjectiveId)
    ) {
      setSelectedObjectiveId(objectives[0]?.id ?? null);
    }
  }, [selectedObjectiveId, objectives]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/participants");
        if (res.ok && !cancelled) setParticipants(await res.json());
      } catch { /* ignore */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const threadMap = new Map<string, string>();
    for (const obj of objectives) {
      if (obj.threadId) threadMap.set(obj.threadId, obj.id);
    }
    if (threadMap.size === 0) return;

    let cancelled = false;
    async function poll() {
      try {
        const threadIds = Array.from(threadMap.keys()).join(",");
        const res = await fetch(`/api/chat-runs/active-agents?threadIds=${encodeURIComponent(threadIds)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const map = new Map<string, string[]>();
        for (const [threadId, agentIds] of Object.entries(data.activeAgents ?? {})) {
          const objectiveId = threadMap.get(threadId);
          if (objectiveId && Array.isArray(agentIds) && agentIds.length > 0) {
            map.set(objectiveId, agentIds as string[]);
          }
        }
        if (!cancelled) setActiveAgentsByObjective(map);
      } catch { /* ignore */ }
    }

    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [objectives]);

  const handleObjectiveSave = async () => {
    if (!objectiveEditor) return;

    const title = objectiveEditor.title.trim();
    if (!title) {
      setSaveError("Objective statement is required.");
      return;
    }
    const teamId = objectiveEditor.teamId.trim();
    if (!teamId) {
      setSaveError("Team is required.");
      return;
    }
    const now = new Date().toISOString();
    const nextObjective = createProjectObjective({
      title,
      teamId,
      key: generateProjectObjectiveKey(title, workspace.objectives),
      summary: objectiveEditor.summary,
      now,
    });

    setIsSaving(true);
    setSaveError(null);

    try {
      await persistWorkspace(upsertProjectObjective(workspace, nextObjective));

      // After the persist succeeds, ensure the built-in worker job exists
      try {
        await fetch(
          `/api/projects/${project?.id}/objectives/${nextObjective.id}/worker`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        );
      } catch {
        // Worker job creation is best-effort — will be lazily created on first run
      }

      setObjectiveEditor(null);
      setSelectedObjectiveId(nextObjective.id);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save objective updates."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleListPanelResize = useCallback((delta: number) => {
    setListPanelWidth((currentWidth) => {
      const nextWidth = Math.max(
        OBJECTIVE_LIST_MIN_WIDTH,
        Math.min(OBJECTIVE_LIST_MAX_WIDTH, currentWidth + delta)
      );
      persistObjectiveListPanelWidth(nextWidth);
      return nextWidth;
    });
  }, []);

  if (isLoading && !project) {
    return <LoadingState label="Loading objectives..." />;
  }

  if (!project) {
    return <LoadingState label="Project not found." />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Left panel: objective list */}
      <div
        className="flex flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--background)]"
        style={{ width: listPanelWidth }}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              Objectives
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {objectives.length === 0 ? "None yet" : `${objectives.length} total`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setObjectiveEditor(buildEmptyObjectiveDraft())}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            aria-label="New objective"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <ErrorBanner message={saveError} />

        <div className="flex-1 overflow-y-auto py-1">
          {objectives.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                No objectives yet.
              </p>
              <button
                type="button"
                onClick={() => setObjectiveEditor(buildEmptyObjectiveDraft())}
                className="mt-2 text-sm text-[var(--primary)] hover:underline"
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {objectives.map((objective) => {
                const objectiveActivities = buildObjectiveTimelineActivities({
                  objective,
                  workspace,
                });

                return (
                  <ObjectiveListCard
                    key={objective.id}
                    objective={objective}
                    activityCount={objectiveActivities.length}
                    lastActivityAt={objectiveActivities[0]?.createdAt ?? null}
                    activeAgentIds={activeAgentsByObjective.get(objective.id)}
                    participants={participants}
                    isSelected={selectedObjectiveId === objective.id}
                    onSelect={() => setSelectedObjectiveId(objective.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ObjectiveListResizeHandle onResize={handleListPanelResize} />

      {/* Right panel: objective detail */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {selectedObjectiveId ? (
          <ProjectObjectiveDetail
            projectSlug={projectSlug}
            objectiveId={selectedObjectiveId}
            onObjectiveDeleted={() => setSelectedObjectiveId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
            {objectives.length === 0
              ? "Create an objective to get started."
              : "Select an objective from the list."}
          </div>
        )}
      </div>

      {objectiveEditor ? (
        <ObjectiveEditorModal
          mode="create"
          draft={objectiveEditor}
          teams={teams}
          isSaving={isSaving}
          onChange={setObjectiveEditor}
          onClose={() => setObjectiveEditor(null)}
          onSave={() => void handleObjectiveSave()}
        />
      ) : null}
    </div>
  );
}

export function ProjectObjectiveDetail({
  projectSlug,
  objectiveId,
  onObjectiveDeleted,
}: ProjectObjectiveDetailProps) {
  const router = useRouter();
  const { isLoading, project, workspace, teams, persistWorkspace, refetchProject } =
    useProjectObjectivesWorkspace(projectSlug);
  const objective = useMemo(
    () => workspace.objectives.find((entry) => entry.id === objectiveId) ?? null,
    [objectiveId, workspace.objectives]
  );
  const teamName = objective ? getTeamName(teams, objective.teamId) : null;
  const [objectiveEditor, setObjectiveEditor] = useState<ObjectiveEditorDraft | null>(null);
  const [teamEditor, setTeamEditor] = useState<ObjectiveTeamDraft | null>(null);

  const [activeTab, setActiveTab] = useState<ObjectiveDetailTab>("activity");
  const [activityTotal, setActivityTotal] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ObjectiveNoteItem[]>([]);
  const [isNotesLoading, setIsNotesLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteTitleDrafts, setNoteTitleDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Set<string>>(new Set());
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [noteSearch, setNoteSearch] = useState("");
  const [linearIssues, setLinearIssues] = useState<ObjectiveLinearIssueSummary[]>([]);
  const [linearConnected, setLinearConnected] = useState(true);
  const [workingOnObjective, setWorkingOnObjective] = useState(false);

  const { jobs: scheduledJobs } = usePromptJobs(project?.id ?? null, {
    requireProjectId: true,
    includeObjectiveJobs: true,
    objectiveId,
  });
  const scheduledTaskCount = useMemo(
    () => scheduledJobs.filter((job) => job.objectiveId === objectiveId).length,
    [scheduledJobs, objectiveId]
  );

  const runPersist = async (nextWorkspace: ProjectObjectiveWorkspaceState) => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await persistWorkspace(nextWorkspace);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save objective updates."
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleObjectiveSave = async () => {
    if (!objectiveEditor || !objective) return;

    const title = objectiveEditor.title.trim();
    if (!title) {
      setSaveError("Objective statement is required.");
      return;
    }

    const nextObjective = {
      ...objective,
      title,
      updatedAt: new Date().toISOString(),
    };

    await runPersist(upsertProjectObjective(workspace, nextObjective));
    setObjectiveEditor(null);
  };

  // Fetch notes when the notes tab is active
  const fetchNotes = useCallback(async () => {
    if (!project?.id || !objective?.id) return;
    setIsNotesLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/objectives/${objective.id}/notes?limit=100`,
      );
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes ?? []);
      }
    } catch {
      // Silently fail — notes will show empty
    } finally {
      setIsNotesLoading(false);
    }
  }, [project?.id, objective?.id]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Refetch when switching to notes tab (in case notes changed elsewhere)
  useEffect(() => {
    if (activeTab === "notes") {
      fetchNotes();
    }
  }, [activeTab, fetchNotes]);

  // Per-note auto-save with debounce (body + title)
  useEffect(() => {
    if (!project?.id || !objective?.id) return;

    // Collect notes that have changed body or title
    const changedNoteIds = new Set<string>();
    for (const [noteId, body] of Object.entries(noteDrafts)) {
      const existing = notes.find((n) => n.id === noteId);
      if (existing && existing.body !== body) changedNoteIds.add(noteId);
    }
    for (const [noteId, title] of Object.entries(noteTitleDrafts)) {
      const existing = notes.find((n) => n.id === noteId);
      if (existing && existing.title !== title) changedNoteIds.add(noteId);
    }

    if (changedNoteIds.size === 0) return;

    const timeouts: number[] = [];

    for (const noteId of changedNoteIds) {
      const patch: Record<string, string> = {};
      const draftBody = noteDrafts[noteId];
      const draftTitle = noteTitleDrafts[noteId];
      const existing = notes.find((n) => n.id === noteId);
      if (!existing) continue;

      if (draftBody !== undefined && draftBody !== existing.body) patch.body = draftBody;
      if (draftTitle !== undefined && draftTitle !== existing.title && draftTitle.trim()) patch.title = draftTitle.trim();

      if (Object.keys(patch).length === 0) continue;

      const timeoutId = window.setTimeout(async () => {
        setSavingNoteIds((prev) => new Set(prev).add(noteId));
        try {
          const res = await fetch(
            `/api/projects/${project.id}/objectives/${objective.id}/notes/${noteId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            },
          );
          if (res.ok) {
            const data = await res.json();
            setNotes((prev) =>
              prev.map((n) => (n.id === noteId ? data.note : n)),
            );
          }
        } catch {
          setSaveError("Failed to save note.");
        } finally {
          setSavingNoteIds((prev) => {
            const next = new Set(prev);
            next.delete(noteId);
            return next;
          });
        }
      }, 700);

      timeouts.push(timeoutId);
    }

    return () => {
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, [noteDrafts, noteTitleDrafts, notes, project?.id, objective?.id]);

  const handleCreateNote = async () => {
    if (!project?.id || !objective?.id) return;
    setIsCreatingNote(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/objectives/${objective.id}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Untitled", body: "" }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setNotes((prev) => [data.note, ...prev]);
        setEditingNoteId(data.note.id);
      }
    } catch {
      setSaveError("Failed to create note.");
    } finally {
      setIsCreatingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!project?.id || !objective?.id) return;
    try {
      const res = await fetch(
        `/api/projects/${project.id}/objectives/${objective.id}/notes/${noteId}`,
        { method: "DELETE" },
      );
      if (res.ok || res.status === 204) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        if (editingNoteId === noteId) setEditingNoteId(null);
      }
    } catch {
      setSaveError("Failed to delete note.");
    }
  };

  const handleTeamSave = async () => {
    if (!teamEditor || !objective) return;

    const teamId = teamEditor.teamId.trim();
    if (!teamId) {
      setSaveError("Team is required.");
      return;
    }
    const nextObjective = {
      ...objective,
      teamId,
      updatedAt: new Date().toISOString(),
    };

    await runPersist(upsertProjectObjective(workspace, nextObjective));
    setTeamEditor(null);
  };


  const handleObjectiveDelete = async () => {
    if (!objective) return;

    const confirmed = window.confirm(`Delete "${objective.title}"?`);
    if (!confirmed) return;

    await runPersist(removeProjectObjective(workspace, objective.id));
    if (onObjectiveDeleted) {
      onObjectiveDeleted();
    } else {
      router.push(`/projects/${projectSlug}`);
    }
  };

  const handleObjectiveThreadLinked = useCallback(
    async (threadId: string) => {
      if (!objective || objective.threadId === threadId) return;
      await runPersist(
        upsertProjectObjective(workspace, {
          ...objective,
          threadId,
          updatedAt: new Date().toISOString(),
        })
      );
    },
    [objective, runPersist, workspace]
  );

  const handleScheduledTaskCreate = useCallback(
    async (data: {
      name: string;
      prompt: string;
      agentId: string;
      provider: string;
      model: string;
      cliArgs: string;
      catchUpPolicy: string;
      cadence: string;
      condition: string;
    }) => {
      if (!project?.id || !objective?.id) {
        setSaveError("Objective not found.");
        return false;
      }

      setSaveError(null);

      try {
        const response = await fetch(
          `/api/projects/${project.id}/objectives/${objective.id}/scheduled-tasks`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...data,
              prompt: prependObjectiveLabelToPrompt(objective, data.prompt),
            }),
          }
        );
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to create scheduled task.");
        }

        await refetchProject();
        return true;
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Failed to create scheduled task."
        );
        return false;
      }
    },
    [objective, project?.id, refetchProject]
  );

  const handleWorkOnObjective = useCallback(async () => {
    if (!project?.id || !objective?.id) {
      setSaveError("Objective not found.");
      return false;
    }

    if (!objective.teamId) {
      setSaveError("Assign a team to this objective before creating a worker.");
      return false;
    }

    setSaveError(null);

    try {
      const response = await fetch(
        `/api/projects/${project.id}/objectives/${objective.id}/worker`,
        { method: "PUT" },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to trigger objective worker.");
      }

      await refetchProject();
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to trigger objective worker."
      );
      return false;
    }
  }, [objective, project?.id, refetchProject]);

  useEffect(() => {
    if (!project?.id || !objective?.id) {
      setLinearIssues([]);
      setLinearConnected(true);
      return;
    }

    const projectId = project.id;
    const currentObjectiveId = objective.id;
    let cancelled = false;

    async function loadObjectiveResources() {
      try {
        const linearResponse = await fetch(
          `/api/projects/${projectId}/objectives/${currentObjectiveId}/linear-issues`
        );
        const linearPayload =
          linearResponse.status === 401
            ? { connected: false, issues: [] as ObjectiveLinearIssueSummary[] }
            : linearResponse.ok
              ? ((await linearResponse.json()) as {
                  connected?: boolean;
                  issues?: ObjectiveLinearIssueSummary[];
                })
              : { connected: true, issues: [] as ObjectiveLinearIssueSummary[] };

        if (cancelled) return;

        setLinearIssues(
          Array.isArray(linearPayload.issues) ? linearPayload.issues : []
        );
        setLinearConnected(linearPayload.connected !== false);
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to load objective resources", error);
        setLinearIssues([]);
        setLinearConnected(true);
      }
    }

    void loadObjectiveResources();

    return () => {
      cancelled = true;
    };
  }, [objective?.id, objective?.key, project?.id]);

  if (isLoading && !project) {
    return <LoadingState label="Loading objective..." />;
  }

  if (!project) {
    return <LoadingState label="Project not found." />;
  }

  if (!objective) {
    return (
      <div className="flex h-full items-center justify-center px-4 bg-[var(--background)]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-8 text-center">
          <p className="text-lg font-semibold text-[var(--foreground)]">Objective not found</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            It may have been deleted or the link is stale.
          </p>
          <Link
            href={`/projects/${projectSlug}`}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
          >
            Back to objectives
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_28%),var(--background)] text-[var(--foreground)]">
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col xl:flex-row">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto pt-16 px-8 pb-20">
              <ErrorBanner message={saveError} />

              <div className="flex items-center gap-3 mb-4">
                <span className="rounded-full border border-[var(--tone-neutral-border)] bg-[var(--tone-neutral-bg)] px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--tone-neutral)]">
                  {objective.key}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${HEALTH_META[objective.status].chipClass}`}
                >
                  {HEALTH_META[objective.status].label}
                </span>
              </div>

              <div className="mb-6">
                {objectiveEditor ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={objectiveEditor.title}
                      onChange={(e) => setObjectiveEditor({ ...objectiveEditor, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleObjectiveSave();
                        if (e.key === "Escape") setObjectiveEditor(null);
                      }}
                      className="flex-1 border-b-2 border-[var(--primary)] bg-transparent px-0 py-1 text-[28px] font-semibold leading-tight text-[var(--foreground)] outline-none"
                      placeholder="Objective statement"
                    />
                    <button
                      type="button"
                      onClick={() => void handleObjectiveSave()}
                      disabled={isSaving}
                      className="rounded-md p-1.5 text-[var(--primary)] transition-colors hover:bg-[var(--status-in-progress-bg)]"
                      aria-label="Save objective"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setObjectiveEditor(null)}
                      className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
                      aria-label="Cancel editing"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Edit objective ${objective.title}`}
                    className="flex items-center gap-3 group cursor-pointer text-left"
                    onClick={() => setObjectiveEditor(buildObjectiveDraft(objective))}
                  >
                    <h1 className="text-[28px] leading-tight font-semibold text-[var(--foreground)]">
                      {objective.title}
                    </h1>
                    <Pencil size={16} className="shrink-0 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )}
              </div>

              {/* Horizontal Metadata Row */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-10">
                {/* Team Property */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <Users size={12} /> Team
                  </span>
                  <span className="text-[var(--app-shell-soft-text)]">·</span>
                  {teamEditor ? (
                    <div className="min-w-[180px]">
                      <SearchCombo
                        options={teams.map((t) => ({ id: t.id, label: t.name }))}
                        value={teamEditor.teamId}
                        onChange={(id) => {
                          const next = { teamId: id };
                          setTeamEditor(next);
                          const teamId = id.trim();
                          if (!teamId || !objective) return;
                          void runPersist(
                            upsertProjectObjective(workspace, {
                              ...objective,
                              teamId,
                              updatedAt: new Date().toISOString(),
                            })
                          );
                          setTeamEditor(null);
                        }}
                        placeholder="Select a team…"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Edit team for ${objective.title}`}
                      onClick={() => setTeamEditor({ teamId: objective.teamId })}
                      className="group -mx-1.5 -my-0.5 flex items-center gap-2 rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--muted)]"
                    >
                      <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold border border-blue-500/30">
                        {(teamName ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)]">
                        {teamName ?? "Not assigned"}
                      </span>
                    </button>
                  )}
                </div>

                {project.id && objective.id ? (
                  <ObjectiveHealthTrend
                    projectId={project.id}
                    objectiveId={objective.id}
                    objectiveKey={objective.key}
                    metadata={project.metadata}
                    currentProgress={objective.progress}
                    currentStatus={objective.status}
                    objectiveUpdatedAt={objective.updatedAt}
                  />
                ) : null}

              </div>

              {/* Work on objective */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={async () => {
                    setWorkingOnObjective(true);
                    await handleWorkOnObjective();
                    setWorkingOnObjective(false);
                  }}
                  disabled={workingOnObjective}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-3 py-2 text-sm text-[var(--status-completed-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {workingOnObjective ? "Working..." : "Work on objective"}
                </button>
              </div>

              {/* Tabs */}
              <div className="mb-8 border-b border-[var(--border)]">
                <nav className="flex gap-1 -mb-px" aria-label="Objective sections">
                  {([
                    { id: "activity" as const, label: "Activity", icon: Clock },
                    { id: "notes" as const, label: "Notes", icon: FileText },
                    { id: "linear" as const, label: "Tasks", icon: LinearIcon },
                    { id: "scheduled-tasks" as const, label: "Scheduled Jobs", icon: CalendarClock },
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? "border-[var(--primary)] text-[var(--foreground)]"
                          : "border-transparent text-[var(--muted-foreground)] hover:border-[var(--border)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <tab.icon size={14} />
                      {tab.label}
                      {tab.id === "activity" && activityTotal > 0 && (
                        <span className="rounded-full bg-[var(--tone-neutral-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--tone-neutral)]">
                          {activityTotal}
                        </span>
                      )}
                      {tab.id === "notes" && notes.length > 0 && (
                        <span className="rounded-full bg-[var(--tone-neutral-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--tone-neutral)]">
                          {notes.length}
                        </span>
                      )}
                      {tab.id === "linear" && (() => {
                        const DONE = ["done", "canceled", "cancelled", "completed", "duplicate"];
                        const active = linearIssues.filter(
                          (i, idx, arr) => arr.findIndex((x) => x.id === i.id) === idx && !DONE.includes(i.status.toLowerCase())
                        );
                        return active.length > 0 ? (
                          <span className="rounded-full bg-[var(--tone-neutral-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--tone-neutral)]">
                            {active.length}
                          </span>
                        ) : null;
                      })()}
                      {tab.id === "scheduled-tasks" && scheduledTaskCount > 0 && (
                        <span className="rounded-full bg-[var(--tone-neutral-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--tone-neutral)]">
                          {scheduledTaskCount}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Tab Content */}
              <div className="space-y-10">
                {/* Notes Tab */}
                {activeTab === "notes" && (
                  <section className="space-y-4">
                    {/* Search + Create */}
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                        <input
                          type="text"
                          value={noteSearch}
                          onChange={(e) => setNoteSearch(e.target.value)}
                          placeholder="Search notes..."
                          className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--app-shell-soft-text)] focus:border-[var(--primary)] focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateNote}
                        disabled={isCreatingNote}
                        className="flex items-center gap-1.5 rounded-md border border-[var(--status-in-progress-border)] bg-[var(--status-in-progress-bg)] px-3 py-1.5 text-sm font-medium text-[var(--status-in-progress-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Plus size={14} />
                        New note
                      </button>
                    </div>

                    {/* Masonry Grid */}
                    {isNotesLoading ? (
                      <p className="py-4 text-sm text-[var(--muted-foreground)]">Loading notes...</p>
                    ) : notes.length === 0 ? (
                      <p className="text-sm text-[var(--muted-foreground)] py-4">
                        No notes yet. Add one above.
                      </p>
                    ) : (() => {
                      const q = noteSearch.toLowerCase();
                      const filtered = q
                        ? notes.filter(
                            (n) =>
                              n.title.toLowerCase().includes(q) ||
                              n.body.toLowerCase().includes(q),
                          )
                        : notes;
                      return filtered.length === 0 ? (
                        <p className="text-sm text-[var(--muted-foreground)] py-4">
                          No notes match your search.
                        </p>
                      ) : (
                        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3" style={{ columnFill: "balance" as const }}>
                          {filtered.map((note) => (
                            <button
                              key={note.id}
                              type="button"
                              onClick={() => setEditingNoteId(note.id)}
                              className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--overlay-panel-muted)] text-left transition-shadow hover:shadow-md"
                            >
                              <div className="px-3 pt-3 pb-1">
                                <h4 className="text-sm font-medium text-[var(--foreground)] leading-snug">
                                  {note.title}
                                </h4>
                              </div>
                              {note.body.trim() && (
                                <div className="px-3 pb-2 text-xs text-[var(--muted-foreground)] line-clamp-4">
                                  <Markdown content={note.body} />
                                </div>
                              )}
                              <div className="flex items-center justify-between px-3 pb-2">
                                <span className="text-[10px] text-[var(--muted-foreground)]">
                                  {new Date(note.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Note Edit Modal */}
                    {editingNoteId && (() => {
                      const note = notes.find((n) => n.id === editingNoteId);
                      if (!note) return null;
                      const draftBody = noteDrafts[note.id] ?? note.body;
                      const draftTitle = noteTitleDrafts[note.id] ?? note.title;
                      const isSavingNote = savingNoteIds.has(note.id);
                      return (
                        <div
                          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[5vh]"
                          onClick={(e) => {
                            if (e.target === e.currentTarget) setEditingNoteId(null);
                          }}
                        >
                          <div className="mx-6 w-full max-w-7xl rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-xl">
                            {/* Modal Header */}
                            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                              <input
                                type="text"
                                autoFocus
                                value={draftTitle}
                                onFocus={(e) => {
                                  if (draftTitle === "Untitled") e.target.select();
                                }}
                                onChange={(e) =>
                                  setNoteTitleDrafts((prev) => ({
                                    ...prev,
                                    [note.id]: e.target.value,
                                  }))
                                }
                                className="flex-1 bg-transparent text-base font-semibold text-[var(--foreground)] focus:outline-none"
                              />
                              <div className="flex items-center gap-2 ml-3">
                                <span className="text-[11px] text-[var(--muted-foreground)]">
                                  {isSavingNote ? "Saving..." : new Date(note.updatedAt).toLocaleDateString()}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNote(note.id)}
                                  className="p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                                >
                                  <Trash2 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingNoteId(null)}
                                  className="p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                            {/* Modal Body */}
                            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
                              <ObjectiveNotesEditor
                                content={draftBody}
                                editable
                                onChange={(value) =>
                                  setNoteDrafts((prev) => ({
                                    ...prev,
                                    [note.id]: value,
                                  }))
                                }
                                placeholder="Write your note..."
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </section>
                )}

                {/* Activity Tab */}
                {activeTab === "activity" && project.id && objective.id && (
                  <ObjectiveActivityTimeline
                    projectId={project.id}
                    objectiveId={objective.id}
                    onTotalChange={setActivityTotal}
                  />
                )}

                {/* Linear Tickets Tab */}
                {activeTab === "linear" && (() => {
                  const dedupedIssues = linearIssues.filter(
                    (issue, idx, arr) => arr.findIndex((i) => i.id === issue.id) === idx
                  );
                  const DONE_STATUSES = ["done", "canceled", "cancelled", "completed", "duplicate"];
                  const activeIssues = dedupedIssues.filter(
                    (i) => !DONE_STATUSES.includes(i.status.toLowerCase())
                  );
                  const doneIssues = dedupedIssues
                    .filter((i) => DONE_STATUSES.includes(i.status.toLowerCase()))
                    .slice(-5);

                  return (
                    <section>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <p className="text-sm text-[var(--muted-foreground)]">
                          Tickets tracked by the objective label{" "}
                          <code className="rounded bg-[var(--tone-neutral-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--foreground)]">
                            {objective.key}
                          </code>.
                        </p>
                      </div>
                      {!linearConnected ? (
                        <EmptyState label="Connect Linear to create and track tickets for this objective." />
                      ) : dedupedIssues.length === 0 ? (
                        <EmptyState label={`No Linear tickets with label ${objective.key} yet.`} />
                      ) : (
                        <>
                          {activeIssues.length > 0 && (
                            <div className="space-y-3">
                              {activeIssues.map((issue) => (
                                <div
                                  key={issue.id}
                                  className="rounded-xl border border-[var(--border)] bg-[var(--overlay-panel-muted)] p-4"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                                        {issue.identifier}
                                      </p>
                                      <a
                                        href={`/projects/${projectSlug}/linear?issue=${issue.id}`}
                                        className="mt-1 block text-sm font-medium text-[var(--foreground)] transition-colors hover:text-[var(--primary)]"
                                      >
                                        {issue.title}
                                      </a>
                                    </div>
                                    <span className="rounded-full border border-[var(--tone-neutral-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--tone-neutral)]">
                                      {issue.status}
                                    </span>
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                                    <span>Updated {formatDateTime(issue.updatedAt)}</span>
                                    <span>{issue.assignee ? `Assigned to ${issue.assignee}` : "Unassigned"}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {doneIssues.length > 0 && (
                            <div className={activeIssues.length > 0 ? "mt-6" : ""}>
                              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)] mb-2">
                                Completed
                              </p>
                              <div className="space-y-0.5">
                                {doneIssues.map((issue) => (
                                  <a
                                    key={issue.id}
                                    href={`/projects/${projectSlug}/linear?issue=${issue.id}`}
                                    className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                                  >
                                    <span className="text-[11px] font-mono shrink-0">{issue.identifier}</span>
                                    <span className="text-[12px] truncate">{issue.title}</span>
                                    <span className="ml-auto shrink-0 text-[10px] text-[var(--app-shell-soft-text)] group-hover:text-[var(--muted-foreground)]">{issue.status}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

                {/* Scheduled Tasks Tab */}
                {activeTab === "scheduled-tasks" && (
                  <section>
                    <ObjectiveScheduledTasksPanel
                      projectId={project.id}
                      objectiveId={objective.id}
                      objectiveKey={objective.key}
                      createDefaults={{
                        name: `Work on ${objective.title}`,
                      }}
                      onCreateTask={handleScheduledTaskCreate}
                    />
                  </section>
                )}

                {/* Danger Zone */}
                <section className="pt-10">
                  <div className="mb-4">
                    <h2 className="text-sm font-semibold text-[var(--destructive)]">Danger Zone</h2>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[var(--destructive-border)] bg-[var(--destructive-bg)] p-5">
                    <div>
                      <h3 className="text-sm font-medium text-[var(--foreground)]">Delete Objective</h3>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        Once you delete an objective, there is no going back.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleObjectiveDelete()}
                      aria-label={`Delete objective ${objective.title}`}
                      className="flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-bg)] px-3 py-1.5 text-sm font-medium text-[var(--destructive)] transition-opacity hover:opacity-90"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <ObjectiveChatPanel
            projectId={project.id}
            projectSlug={projectSlug}
            objective={objective}
            teamName={teamName}
            onThreadLinked={handleObjectiveThreadLinked}
            onObjectiveUpdated={refetchProject}
          />
        </div>
      </div>

    </div>
  );
}

export function ProjectObjectivesWorkspace(props: ProjectObjectivesWorkspaceProps) {
  return <ProjectObjectivesOverview {...props} />;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--overlay-panel-muted)] p-6">
      <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
    </div>
  );
}

function ObjectiveEditorModal({
  mode,
  draft,
  teams = [],
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  draft: ObjectiveEditorDraft;
  teams?: ProjectTeamSummary[];
  isSaving: boolean;
  onChange: (draft: ObjectiveEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit objective" : "New objective"}
        className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--overlay-panel-strong)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {mode === "edit" ? "Edit objective" : "New objective"}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {mode === "edit"
              ? "Update the tracking details for this objective."
              : "Keep the statement measurable and use notes only for context that matters."}
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <FieldLabel label="Objective statement" />
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
              placeholder="Get 50 qualified visitors daily"
            />
          </div>

          {mode === "create" ? (
            <div>
              <FieldLabel label="Team" />
              <select
                value={draft.teamId}
                onChange={(event) => onChange({ ...draft, teamId: event.target.value })}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input)] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
              >
                <option value="">Select a team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Teams can only own one objective at a time.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-xl border border-[var(--status-in-progress-border)] bg-[var(--status-in-progress-bg)] px-3 py-2 text-sm font-medium text-[var(--status-in-progress-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : mode === "edit" ? "Save objective" : "Create objective"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
      {label}
    </label>
  );
}

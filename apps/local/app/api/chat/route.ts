import { NextRequest } from "next/server";
import {
  mergeComposerRouting,
  normalizeComposerRouting,
  orderParticipantIds,
} from "@/lib/chat/composer-routing";
import {
  findProjectMentionSlugs,
  normalizeProjectSlug,
  resolveProjectContext,
} from "@/lib/chat/project-context";
import { loadDbParticipants } from "@/lib/agent-participants";
import { createChatRun, loadHistory, saveMessages, sweepStaleWorkingReactions } from "@/lib/history-store";
import { finalizeAttachments } from "@/lib/attachment-store";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { deactivateSchedulesByRootMessageId } from "@/src/graph/store";
import type { GroupMessage, Participant } from "@/lib/types";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import type { ChatRunPayload, ChatRunJobData } from "@/lib/orchestrator/chat-types";
import { ensureOrchestratorRuntime } from "@/lib/orchestrator/runtime";
import { getDebugLogPath, writeDebugLog } from "@/lib/debug-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  threadId?: unknown;
  prompt?: unknown;
  maxRounds?: unknown;
  userMessageId?: unknown;
  rootMessageId?: unknown;
  attachmentIds?: unknown;
  activeParticipantIds?: unknown;
  projectSlug?: unknown;
  promptPrefix?: unknown;
  role?: unknown;
  agent?: unknown;
  routing?: unknown;
}

const MAX_HISTORY_CHARS = 200_000;
const SUMMARY_MARKER = "<!-- thread-summary -->";
const CHAT_MENTION_PATTERN = /@([A-Za-z0-9_-]+)/g;

type ParticipantNameMap = Record<string, { name: string }>;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getSpeakerLabel(message: GroupMessage, participantMap: ParticipantNameMap): string {
  if (message.role === "user") return "User";
  if (!message.participantId) return "Assistant";
  return participantMap[message.participantId]?.name || message.participantId;
}

function buildHistoryContext(history: GroupMessage[], participantMap: ParticipantNameMap): string {
  const lines: string[] = [];
  let totalChars = 0;

  // Iterate newest-first so the most recent context is always included
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    const line = `${getSpeakerLabel(message, participantMap)}: ${message.content}`;
    if (totalChars + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    totalChars += line.length;
  }

  if (lines.length === 0) return "";
  return `Previous conversation (for background context only — do NOT re-discuss or repeat these topics unless the user brings them up again):\n${lines.join("\n")}`;
}

function extractThreadSummary(content: string): string | null {
  if (!content.startsWith(SUMMARY_MARKER)) return null;
  const text = normalizeText(content.slice(SUMMARY_MARKER.length));
  return text || null;
}

function getMessageContextContent(message: GroupMessage): string {
  const summary = extractThreadSummary(message.content);
  return summary ?? message.content;
}

function toRootAlias(text: string): string | null {
  const normalized = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .trim();
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return null;
  return words.join("-");
}

function getParticipantMentionTokens(participants: Participant[]): Set<string> {
  const tokens = new Set<string>(["all"]);

  for (const participant of participants) {
    tokens.add(participant.id.toLowerCase());
    const nameTokens = normalizeText(participant.name).toLowerCase().split(/\s+/).filter(Boolean);
    for (const token of nameTokens) {
      tokens.add(token);
    }
  }

  return tokens;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
}

interface ProjectAgentRow {
  project_id: string;
  agent_id: string;
  routing_order: number;
}

function loadProjectsWithAgents(): { projects: ProjectRow[]; agentsByProject: Record<string, ProjectAgentRow[]> } {
  try {
    const db = getSQLiteDb();
    const projects = db.prepare("SELECT id, name, slug FROM projects").all() as unknown as ProjectRow[];
    const agents = db.prepare("SELECT * FROM project_agents ORDER BY routing_order ASC").all() as unknown as ProjectAgentRow[];
    const agentsByProject: Record<string, ProjectAgentRow[]> = {};
    for (const a of agents) {
      (agentsByProject[a.project_id] ??= []).push(a);
    }
    return { projects, agentsByProject };
  } catch {
    return { projects: [], agentsByProject: {} };
  }
}

function detectPromptMentions(
  prompt: string,
  participants: Participant[],
  activeParticipants?: Participant[]
): { mentioned: Set<string>; parallel: Set<string> } {
  const mentioned = new Set<string>();
  const parallel = new Set<string>();
  const lower = prompt.toLowerCase();

  const hasParallelAll = lower.includes("@@all");
  const hasAll = lower.includes("@all");
  if (hasAll || hasParallelAll) {
    // @all only expands to active participants, not the full library
    const allScope = activeParticipants ?? participants;
    for (const participant of allScope) {
      mentioned.add(participant.id);
      if (hasParallelAll) {
        parallel.add(participant.id);
      }
    }
    return { mentioned, parallel };
  }

  // Expand @ProjectName → project member agent IDs (sequential by routing_order)
  // @@ProjectName → parallel
  const { projects, agentsByProject } = loadProjectsWithAgents();
  for (const project of projects) {
    const projectNameLower = project.name.toLowerCase();
    const projectSlugLower = project.slug.toLowerCase();
    const hasParallelProject = lower.includes(`@@${projectNameLower}`) || lower.includes(`@@${projectSlugLower}`);
    const hasProject = lower.includes(`@${projectNameLower}`) || lower.includes(`@${projectSlugLower}`);
    if (hasParallelProject || hasProject) {
      const members = agentsByProject[project.id] ?? [];
      for (const member of members) {
        mentioned.add(member.agent_id);
        if (hasParallelProject) {
          parallel.add(member.agent_id);
        }
      }
    }
  }

  // Individual @Name resolves against the full library
  for (const participant of participants) {
    const id = participant.id.toLowerCase();
    const name = participant.name.toLowerCase();
    const hasParallelMention = lower.includes(`@@${id}`) || lower.includes(`@@${name}`);
    const hasMention = lower.includes(`@${id}`) || lower.includes(`@${name}`);
    if (hasParallelMention || hasMention) {
      mentioned.add(participant.id);
      if (hasParallelMention) {
        parallel.add(participant.id);
      }
    }
  }

  return { mentioned, parallel };
}

function findReferencedRootIds(
  prompt: string,
  participants: Participant[],
  rootMessages: GroupMessage[]
): string[] {
  const mentionTokens = Array.from(prompt.matchAll(CHAT_MENTION_PATTERN), (match) =>
    match[1].toLowerCase()
  );
  if (mentionTokens.length === 0 || rootMessages.length === 0) return [];

  const participantTokens = getParticipantMentionTokens(participants);
  const lookup = new Map<string, string>();

  const newestRoots = [...rootMessages].sort((a, b) => b.timestamp - a.timestamp);
  newestRoots.forEach((rootMessage, index) => {
    lookup.set(rootMessage.id.toLowerCase(), rootMessage.id);
    lookup.set(`chat${index + 1}`, rootMessage.id);
    const alias = toRootAlias(rootMessage.content);
    if (alias && !lookup.has(alias)) {
      lookup.set(alias, rootMessage.id);
    }
  });

  const referencedIds = new Set<string>();
  for (const token of mentionTokens) {
    if (participantTokens.has(token)) continue;
    if (token.startsWith("project-")) continue;
    const rootId = lookup.get(token);
    if (rootId) {
      referencedIds.add(rootId);
    }
  }

  return Array.from(referencedIds);
}

function buildReferencedChatContext(
  history: GroupMessage[],
  participantMap: ParticipantNameMap,
  referencedRootIds: string[]
): string {
  if (referencedRootIds.length === 0) return "";

  const blocks: string[] = [];
  for (const rootId of referencedRootIds) {
    const root = history.find((message) => message.id === rootId);
    if (!root) continue;

    const threadMessages = history
      .filter((message) => message.id === rootId || message.rootMessageId === rootId)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (threadMessages.length === 0) continue;

    const lines = threadMessages.map((message) => {
      const speaker = getSpeakerLabel(message, participantMap);
      const content = getMessageContextContent(message);
      return `${speaker}: ${content}`;
    });

    blocks.push(
      `Referenced chat (${root.id})\nRoot: ${normalizeText(root.content)}\n${lines.join("\n")}`
    );
  }

  if (blocks.length === 0) return "";
  return `Referenced chats (only because the user explicitly @mentioned them):\n\n${blocks.join("\n\n---\n\n")}`;
}

function toActiveParticipantIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim()
      : "";
  const threadId =
    typeof body.threadId === "string"
      ? body.threadId.trim()
      : "";
  const promptPrefix =
    typeof body.promptPrefix === "string"
      ? body.promptPrefix
      : "";
  const scopedProjectSlug = normalizeProjectSlug(body.projectSlug);

  if (!threadId) {
    writeDebugLog("chat.post.reject", {
      reason: "missing_thread_id",
      promptLength: prompt.length,
    });
    return new Response(JSON.stringify({ error: "threadId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!prompt) {
    writeDebugLog("chat.post.reject", {
      reason: "missing_prompt",
      threadId,
    });
    return new Response(JSON.stringify({ error: "No prompt provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const participantLibrary = await loadDbParticipants();
  const routing = normalizeComposerRouting(body.routing);
  const hasActiveFilter = Array.isArray(body.activeParticipantIds);
  const requestedActiveIds = orderParticipantIds(
    toActiveParticipantIds(body.activeParticipantIds),
    routing.pinnedParticipantId
  );
  const activeIdSet = hasActiveFilter ? new Set(requestedActiveIds) : null;

  const filteredParticipants =
    activeIdSet === null
      ? participantLibrary
      : participantLibrary.filter((participant) => activeIdSet.has(participant.id));
  // Recover from stale stored active IDs: if a non-empty filter resolves to nothing,
  // fall back to the full participant library so chat still works.
  const baseParticipants =
    activeIdSet !== null && requestedActiveIds.length > 0 && filteredParticipants.length === 0
      ? participantLibrary
      : filteredParticipants;

  // @Name resolves against the full library (lets users wake an inactive agent).
  // @all only expands to the active participants — not the full library.
  const {
    mentioned,
    parallel: parallelMentioned,
  } = mergeComposerRouting(
    detectPromptMentions(prompt, participantLibrary, baseParticipants),
    routing
  );

  const selectedIds = new Set(baseParticipants.map((participant) => participant.id));
  for (const id of mentioned) selectedIds.add(id);

  const prioritizedActiveIds =
    routing.mentionedParticipantIds.length > 0
      ? [
          ...routing.mentionedParticipantIds,
          ...requestedActiveIds.filter(
            (participantId) => !routing.mentionedParticipantIds.includes(participantId)
          ),
        ]
      : requestedActiveIds;

  // Preserve activeParticipantIds order so the first (primary) agent in the
  // sidebar becomes allParticipants[0] — the default responder when no agent
  // is explicitly mentioned.
  const allParticipantsUnsorted = participantLibrary.filter((participant) => selectedIds.has(participant.id));
  const orderIndex = new Map(prioritizedActiveIds.map((id, i) => [id, i]));
  const allParticipants = allParticipantsUnsorted.sort((a, b) => {
    const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  if (allParticipants.length === 0) {
    writeDebugLog("chat.post.reject", {
      reason: "no_participants",
      threadId,
      requestedActiveIds,
      scopedProjectSlug,
    });
    return new Response(JSON.stringify({ error: "No active agents configured for this project" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectContext = await resolveProjectContext(
    scopedProjectSlug,
    findProjectMentionSlugs(prompt),
    allParticipants
  );
  const now = Date.now();
  const rawUserMessageId =
    typeof body.userMessageId === "string"
      ? body.userMessageId.trim()
      : "";
  const userMessageId = rawUserMessageId || crypto.randomUUID();
  const explicitRootMessageId =
    typeof body.rootMessageId === "string"
      ? body.rootMessageId.trim() || null
      : null;

  // Load conversation history for context.
  await sweepStaleWorkingReactions(threadId);
  const history = await loadHistory(threadId);
  const participantMap: ParticipantNameMap = Object.fromEntries(
    participantLibrary.map((p) => [p.id, { name: p.name }])
  );

  const rootMessages = history.filter(
    (message) =>
      message.role === "user" &&
      !message.rootMessageId &&
      message.id !== (explicitRootMessageId || "")
  );
  const referencedRootIds = explicitRootMessageId
    ? findReferencedRootIds(prompt, participantLibrary, rootMessages)
    : [];

  const subthreadHistory = history.filter(
    (message) => message.id === explicitRootMessageId || message.rootMessageId === explicitRootMessageId
  );
  const contextHistory = subthreadHistory;
  const historyContext = buildHistoryContext(contextHistory, participantMap);
  const referencedChatContext = buildReferencedChatContext(
    history,
    participantMap,
    referencedRootIds
  );
  const promptContext = [historyContext, referencedChatContext].filter(Boolean).join("\n\n---\n\n");

  // Save user message — main chat messages are roots (depth 0, no rootMessageId),
  // thread replies reference their root.
  const requestedRole = body.role === "agent" ? "assistant" : "user";
  const requestedAgent =
    requestedRole === "assistant" && typeof body.agent === "string"
      ? body.agent.trim() || null
      : null;
  // Resolve agent participantId: match by slug/id against the participant library.
  const resolvedParticipantId =
    requestedRole === "assistant"
      ? (requestedAgent
          ? (participantLibrary.find(
              (p) => p.id === requestedAgent || p.name.toLowerCase() === requestedAgent.toLowerCase()
            )?.id ?? requestedAgent)
          : allParticipants[0]?.id ?? null)
      : null;
  const userMessage: GroupMessage = {
    id: userMessageId,
    role: requestedRole,
    participantId: resolvedParticipantId,
    content: prompt,
    timestamp: now,
    rootMessageId: explicitRootMessageId,
    parentMessageId: explicitRootMessageId,
    depth: explicitRootMessageId ? 1 : 0,
  };
  await saveMessages(threadId, [userMessage]);

  // Only deactivate ship mode when the USER sends a message, not agent-role steering
  if (explicitRootMessageId && requestedRole === "user") {
    try {
      deactivateSchedulesByRootMessageId(explicitRootMessageId);
    } catch (error) {
      console.warn("Failed to deactivate autonomous schedule on user composer message", {
        rootMessageId: explicitRootMessageId,
        error,
      });
    }
  }

  // Finalize attachments if provided
  const rawAttachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((id): id is string => typeof id === "string") : [];
  let attachmentContext = "";
  if (rawAttachmentIds.length > 0) {
    const finalized = await finalizeAttachments(userMessageId, rawAttachmentIds);
    if (finalized.length > 0) {
      const lines = finalized.map((a) => `- ${a.filename} (${a.mimeType}, ${a.size} bytes): ${a.diskPath}`);
      attachmentContext = `\n\n[Attached files]\n${lines.join("\n")}\n`;
    }
  }

  // Agent replies always go into the thread.
  // If user sent a main-chat message, agents reply to that message (userMessageId is the root).
  // If user replied in a thread, agents reply in that same thread.
  const agentRootMessageId = explicitRootMessageId || userMessageId;

  const maxRounds = Math.min(
    Math.max(Number(body.maxRounds) || 10, 1),
    50
  );

  const enrichedPrompt = promptPrefix ? promptPrefix + prompt : prompt;
  const fullPrompt = promptContext
    ? `${promptContext}\n\n---\nCurrent user message:\n${enrichedPrompt}${attachmentContext}`
    : `${enrichedPrompt}${attachmentContext}`;

  // Extract recent assistant messages for dedup and recent messages for reaction targeting.
  const recentTargetableMessages = subthreadHistory
    .slice(-20)
    .map((m) => ({
      id: m.id,
      name:
        m.role === "user"
          ? "User"
          : m.participantId
            ? participantMap[m.participantId]?.name || m.participantId
            : "Assistant",
      content: m.content,
    }));

  const chatRunId = crypto.randomUUID();
  const chatRunPayload: ChatRunPayload = {
    threadId,
    prompt: fullPrompt,
    projectContext,
    mentionedIds: Array.from(mentioned),
    initialParallelIds: Array.from(parallelMentioned),
    maxRounds,
    recentHistory: recentTargetableMessages,
    currentUserMessageId: userMessageId,
    rootMessageId: agentRootMessageId,
    participantIds: allParticipants.map((participant) => participant.id),
  };

  writeDebugLog("chat.post.accepted", {
    threadId,
    chatRunId,
    userMessageId,
    rootMessageId: agentRootMessageId,
    explicitRootMessageId,
    participantIds: allParticipants.map((participant) => participant.id),
    providerIdsMentioned: Array.from(mentioned),
    parallelIds: Array.from(parallelMentioned),
    scopedProjectSlug: scopedProjectSlug || null,
    hasProjectContext: Boolean(projectContext),
    promptLength: prompt.length,
    debugLogPath: getDebugLogPath(),
  });

  await createChatRun({
    id: chatRunId,
    threadId,
    rootMessageId: agentRootMessageId,
    userId: LOCAL_USER.id,
    projectSlug: scopedProjectSlug || null,
    maxSteps: maxRounds,
    activeParticipantIds: allParticipants.map((participant) => participant.id),
    payload: chatRunPayload as unknown as Record<string, unknown>,
  });

  await ensureOrchestratorRuntime();
  writeDebugLog("chat.runtime.ready", { chatRunId, threadId });
  const queue = await getQueue();
  await queue.send<ChatRunJobData>(QUEUE_NAMES.CHAT_RUN_PROCESS, {
    chatRunId,
    userId: LOCAL_USER.id,
    signal: "start",
  });
  writeDebugLog("chat.queue.sent", {
    chatRunId,
    threadId,
    queue: QUEUE_NAMES.CHAT_RUN_PROCESS,
  });

  return Response.json({ ok: true, userMessageId, chatRunId }, { status: 202 });
}

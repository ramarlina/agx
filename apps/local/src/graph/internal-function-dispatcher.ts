import type { FunctionDispatchResult } from "./function-executor";
import type { ExecutionGraph, FunctionNode, WorkNode } from "./types";
import { LOCAL_USER } from "@/lib/auth-mode";
import { loadDbParticipants } from "@/lib/agent-participants";
import { resolveProjectContext } from "@/lib/chat/project-context";
import { writeDebugLog } from "@/lib/debug-log";
import { ensureOrchestratorRuntime } from "@/lib/orchestrator/runtime";
import type { ChatRunJobData, ChatRunPayload } from "@/lib/orchestrator/chat-types";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import type { GroupMessage } from "@/lib/types";

const ACTIVE_PROCESS_STATUSES = new Set(["running", "working"]);
const RECENT_STEER_HISTORY_LIMIT = 20;
const STEER_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const SHIP_MODE_MAX_ROUNDS = 10;

function getRootMessageId(node: FunctionNode, graph: ExecutionGraph): string {
  const fromArgs = typeof node.args?.rootMessageId === "string" ? node.args.rootMessageId.trim() : "";
  if (fromArgs) return fromArgs;
  return graph.schedule?.rootMessageId?.trim() ?? "";
}

function getSteerOutput(
  node: FunctionNode,
  graph: ExecutionGraph,
): { isDone: boolean; message: string } | null {
  const steerNodeId =
    typeof node.args?.steerNodeId === "string" && node.args.steerNodeId.trim()
      ? node.args.steerNodeId.trim()
      : "steer";
  const steerNode = graph.nodes[steerNodeId];
  if (!steerNode || steerNode.type !== "work") {
    return null;
  }
  const output = (steerNode as WorkNode).output;
  if (!output || typeof output !== "object") {
    return null;
  }
  return {
    isDone: Boolean(output.isDone),
    message: typeof output.message === "string" ? output.message : "",
  };
}

function normalizeSteerText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function getSpeakerLabel(message: GroupMessage, participantNames: Record<string, string>): string {
  if (message.role === "user") return "User";
  if (!message.participantId) return "Assistant";
  return participantNames[message.participantId] || message.participantId;
}

function buildRecentHistory(
  history: GroupMessage[],
  rootMessageId: string,
  participantNames: Record<string, string>
): Array<{ id: string; name: string; content: string }> {
  return history
    .filter((message) => message.id === rootMessageId || message.rootMessageId === rootMessageId)
    .slice(-RECENT_STEER_HISTORY_LIMIT)
    .map((message) => ({
      id: message.id,
      name: getSpeakerLabel(message, participantNames),
      content: message.content,
    }));
}

function hasRecentDuplicateSteer(
  history: GroupMessage[],
  rootMessageId: string,
  candidate: string,
  participantId: string | null
): boolean {
  const normalizedCandidate = normalizeSteerText(candidate);
  if (!normalizedCandidate) return false;
  const cutoff = Date.now() - STEER_DUPLICATE_WINDOW_MS;

  return history
    .filter((message) => message.id === rootMessageId || message.rootMessageId === rootMessageId)
    .some((message) => {
      if (message.role !== "assistant") return false;
      if (message.timestamp < cutoff) return false;
      if (participantId && message.participantId !== participantId) return false;
      return normalizeSteerText(message.content) === normalizedCandidate;
    });
}

async function getThreadProjectContext(threadId: string): Promise<{
  projectSlug: string | null;
  projectAgentIds: string[];
}> {
  try {
    const { getSQLiteDb } = await import("@/lib/sqlite-query-adapter");
    const db = getSQLiteDb();
    const projectRow = db
      .prepare(
        `SELECT pt.project_id AS project_id, p.slug AS project_slug
         FROM project_threads pt
         JOIN projects p ON p.id = pt.project_id
         WHERE pt.thread_id = ?
         ORDER BY pt.created_at ASC
         LIMIT 1`
      )
      .get(threadId) as { project_id: string; project_slug: string | null } | undefined;
    if (!projectRow?.project_id) {
      return { projectSlug: null, projectAgentIds: [] };
    }

    const agentRows = db
      .prepare(
        "SELECT agent_id FROM project_agents WHERE project_id = ? ORDER BY routing_order ASC, created_at ASC",
      )
      .all(projectRow.project_id) as Array<{ agent_id: string }>;

    return {
      projectSlug: projectRow.project_slug?.trim() || null,
      projectAgentIds: agentRows
        .map((row) => row.agent_id?.trim())
        .filter((agentId): agentId is string => Boolean(agentId)),
    };
  } catch {
    return { projectSlug: null, projectAgentIds: [] };
  }
}

async function dispatchThreadStatus(node: FunctionNode, graph: ExecutionGraph): Promise<FunctionDispatchResult> {
  const rootMessageId = getRootMessageId(node, graph);
  if (!rootMessageId) {
    return { status: "failure", message: "thread-status requires rootMessageId" };
  }

  const { getMessageThread, getThreadStatusSnapshot, sweepStaleWorkingReactions } = await import("@/lib/history-store");
  const threadRef = await getMessageThread(rootMessageId);
  if (!threadRef) {
    return {
      status: "failure",
      message: `Thread not found for rootMessageId: ${rootMessageId}`,
    };
  }

  await sweepStaleWorkingReactions(threadRef.threadId);
  const snapshot = await getThreadStatusSnapshot({
    threadId: threadRef.threadId,
    rootMessageId,
  });

  const activeProcessCount = snapshot.processes.filter(
    (process: { status: string }) => ACTIVE_PROCESS_STATUSES.has(process.status),
  ).length;

  return {
    status: "success",
    output: {
      activeProcessCount,
      messageCount: snapshot.messages?.length ?? 0,
      threadId: threadRef.threadId,
      lastUpdatedAt: snapshot.lastUpdatedAt,
    },
  };
}

async function dispatchShipModeAct(node: FunctionNode, graph: ExecutionGraph): Promise<FunctionDispatchResult> {
  const rootMessageId = getRootMessageId(node, graph);
  if (!rootMessageId) {
    return { status: "failure", message: "ship-mode-act requires rootMessageId" };
  }

  const steer = getSteerOutput(node, graph);
  if (!steer) {
    return { status: "failure", message: "Unable to read steer node output" };
  }

  if (!normalizeSteerText(steer.message)) {
    return { status: "failure", message: "Ship mode produced an empty steer message" };
  }

  const {
    createChatRun,
    getThreadStatusSnapshot,
    getMessageThread,
    loadHistory,
    saveMessages,
    updateMessageStatus,
  } = await import("@/lib/history-store");
  const { deactivateSchedulesByRootMessageId } = await import("./store");
  const threadRef = await getMessageThread(rootMessageId);
  if (!threadRef) {
    return {
      status: "failure",
      message: `Thread not found for rootMessageId: ${rootMessageId}`,
    };
  }

  if (steer.isDone) {
    const snapshot = await getThreadStatusSnapshot({
      threadId: threadRef.threadId,
      rootMessageId,
    });
    const activeProcessCount = snapshot.processes.filter((process: { status: string }) =>
      ACTIVE_PROCESS_STATUSES.has(process.status)
    ).length;
    if (activeProcessCount > 0) {
      return {
        status: "success",
        output: {
          done: false,
          action: "completion_deferred_active_work",
          activeProcessCount,
        },
      };
    }
    deactivateSchedulesByRootMessageId(rootMessageId);
    await updateMessageStatus(threadRef.threadId, rootMessageId, "in-review", null);
    return {
      status: "success",
      output: { done: true, action: "stopped_and_in_review" },
    };
  }

  const participantLibrary = await loadDbParticipants();
  const participantNames = Object.fromEntries(
    participantLibrary.map((participant) => [participant.id, participant.name])
  );
  const { projectSlug, projectAgentIds } = await getThreadProjectContext(threadRef.threadId);
  const threadHistory = await loadHistory(threadRef.threadId);
  const defaultAgent = projectAgentIds[0] ?? participantLibrary[0]?.id ?? null;

  if (hasRecentDuplicateSteer(threadHistory, rootMessageId, steer.message, defaultAgent)) {
    return {
      status: "success",
      output: {
        done: false,
        action: "duplicate_next_steps_skipped",
        sender: defaultAgent,
      },
    };
  }

  const messageId = crypto.randomUUID();
  await saveMessages(threadRef.threadId, [
    {
      id: messageId,
      role: "assistant",
      participantId: defaultAgent,
      content: steer.message,
      timestamp: Date.now(),
      rootMessageId,
      parentMessageId: rootMessageId,
      depth: 1,
    },
  ]);

  const orderedParticipantIds = (projectAgentIds.length > 0
    ? projectAgentIds
    : participantLibrary.map((participant) => participant.id))
    .filter((participantId, index, allIds) => participantId && allIds.indexOf(participantId) === index);
  const responderIds = orderedParticipantIds.filter((participantId) => participantId !== defaultAgent);
  const runParticipantIds = (responderIds.length > 0 ? responderIds : orderedParticipantIds).filter((participantId) =>
    participantLibrary.some((participant) => participant.id === participantId)
  );

  if (runParticipantIds.length === 0) {
    return {
      status: "success",
      output: {
        done: false,
        action: "sent_next_steps_only",
        sender: defaultAgent,
        messageId,
      },
    };
  }

  const runParticipants = participantLibrary.filter((participant) => runParticipantIds.includes(participant.id));
  const projectContext = projectSlug
    ? await resolveProjectContext(projectSlug, [], runParticipants)
    : undefined;
  const chatRunId = crypto.randomUUID();
  const chatRunPayload: ChatRunPayload = {
    threadId: threadRef.threadId,
    prompt: steer.message,
    projectContext,
    mentionedIds: [],
    initialParallelIds: [],
    maxRounds: SHIP_MODE_MAX_ROUNDS,
    recentHistory: buildRecentHistory(threadHistory, rootMessageId, participantNames),
    currentUserMessageId: messageId,
    rootMessageId,
    participantIds: runParticipantIds,
  };

  await createChatRun({
    id: chatRunId,
    threadId: threadRef.threadId,
    rootMessageId,
    userId: LOCAL_USER.id,
    projectSlug: projectSlug ?? null,
    maxSteps: SHIP_MODE_MAX_ROUNDS,
    activeParticipantIds: runParticipantIds,
    payload: chatRunPayload as unknown as Record<string, unknown>,
  });

  await ensureOrchestratorRuntime();
  const queue = await getQueue();
  await queue.send<ChatRunJobData>(QUEUE_NAMES.CHAT_RUN_PROCESS, {
    chatRunId,
    userId: LOCAL_USER.id,
    signal: "start",
  });

  writeDebugLog("ship_mode.steer.enqueued", {
    rootMessageId,
    threadId: threadRef.threadId,
    chatRunId,
    authorId: defaultAgent,
    participantIds: runParticipantIds,
    projectSlug: projectSlug ?? null,
  });

  return {
    status: "success",
    output: {
      done: false,
      action: "sent_next_steps_and_started_chat_run",
      sender: defaultAgent,
      messageId,
      chatRunId,
    },
  };
}

export async function dispatchInternalFunction(
  node: FunctionNode,
  graph: ExecutionGraph,
): Promise<FunctionDispatchResult> {
  if (node.kind !== "internal") {
    return {
      status: "failure",
      message: `Unsupported function node kind: ${node.kind}`,
    };
  }

  switch (node.command) {
    case "thread-status":
      return dispatchThreadStatus(node, graph);
    case "ship-mode-act":
      return dispatchShipModeAct(node, graph);
    default:
      return {
        status: "failure",
        message: `Unsupported internal function command: ${node.command}`,
      };
  }
}

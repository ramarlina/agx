import "server-only";

import { LOCAL_USER } from "@/lib/auth-mode";
import { loadDbParticipants } from "@/lib/agent-participants";
import {
  buildTrackerExecutionPrompt,
  renderTrackerExecutionPromptTemplate,
  type TrackerExecutionPromptInput,
} from "@/lib/tracker/tracker-execution-prompt";
import {
  createTrackerRun,
  updateTrackerRun,
  type TrackerRunRecord,
} from "@/lib/tracker/tracker-run-store";
import { readLatestRecap } from "@/src/linear-recap/storage";
import { createChatRun, saveMessages } from "@/lib/history-store";
import { ensureOrchestratorRuntime } from "@/lib/orchestrator/runtime";
import type { ChatRunJobData, ChatRunPayload } from "@/lib/orchestrator/chat-types";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { normalizeProjectSlug, resolveProjectContext } from "@/lib/chat/project-context";
import type { GroupMessage } from "@/lib/types";

export interface ScriptedTrackerSessionIssueInput {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee?: string | null;
}

export interface StartScriptedTrackerSessionInput {
  trackerType: string;
  projectId?: string | null;
  projectSlug?: string | null;
  issue: ScriptedTrackerSessionIssueInput;
  agentId: string;
  scriptName?: string | null;
  scriptPrompt?: string | null;
}

export interface StartedScriptedTrackerSession {
  run: TrackerRunRecord;
  chatRunId: string;
  userMessageId: string;
}

/**
 * Start a scripted tracker session.
 * The pipeline is tracker-agnostic — it operates on canonical item fields.
 */
export async function startScriptedTrackerSession(
  input: StartScriptedTrackerSessionInput
): Promise<StartedScriptedTrackerSession> {
  const participants = await loadDbParticipants();
  const agent = participants.find((participant) => participant.id === input.agentId) ?? null;
  if (!agent) {
    throw new Error(`Agent "${input.agentId}" could not be resolved for scripted tracker work.`);
  }

  const latestRecap = await readLatestRecap(input.issue.id);

  let run = await createTrackerRun({
    projectId: input.projectId ?? null,
    projectSlug: input.projectSlug ?? null,
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    issueTitle: input.issue.title,
    issueStatus: input.issue.status,
    issueAssignee: input.issue.assignee ?? null,
    agentId: agent.id,
    agentName: agent.name,
    mode: "scripted",
    recapFilePath: latestRecap?.filePath ?? null,
  });

  try {
    const promptInput: TrackerExecutionPromptInput = {
      issue: {
        identifier: input.issue.identifier,
        title: input.issue.title,
        status: input.issue.status,
        assignee: input.issue.assignee ?? null,
      },
      project: input.projectSlug ? { slug: input.projectSlug } : null,
      runtime: {
        recapContent: latestRecap?.content ?? null,
      },
    };
    const { prompt: defaultPrompt, promptPrefix } = buildTrackerExecutionPrompt(promptInput);
    const customScriptPrompt = input.scriptPrompt?.trim() ?? "";
    const customScriptName = input.scriptName?.trim() ?? "";
    const prompt = customScriptPrompt
      ? renderTrackerExecutionPromptTemplate(customScriptPrompt, promptInput).trim() || defaultPrompt
      : defaultPrompt;
    const effectivePromptPrefix = customScriptPrompt
      ? `${promptPrefix}ACTIVE SESSION SCRIPT\n- Name: ${customScriptName || "Custom script"}\n\n`
      : promptPrefix;

    const { chatRunId, userMessageId } = await launchChatRun({
      threadId: run.threadId,
      prompt,
      promptPrefix: effectivePromptPrefix,
      projectSlug: input.projectSlug ?? null,
      participantId: agent.id,
    });

    run =
      (await updateTrackerRun({
        id: run.id,
        chatRunId,
        rootMessageId: userMessageId,
      })) ?? run;

    return {
      run,
      chatRunId,
      userMessageId,
    };
  } catch (error) {
    await updateTrackerRun({
      id: run.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function launchChatRun(input: {
  threadId: string;
  prompt: string;
  promptPrefix?: string;
  projectSlug?: string | null;
  participantId: string;
  maxRounds?: number;
}): Promise<{ chatRunId: string; userMessageId: string }> {
  const participants = await loadDbParticipants();
  const agent = participants.find((participant) => participant.id === input.participantId) ?? null;
  if (!agent) {
    throw new Error(`Participant "${input.participantId}" is unavailable.`);
  }

  const scopedProjectSlug = normalizeProjectSlug(input.projectSlug);
  const projectContext = await resolveProjectContext(scopedProjectSlug, [], [agent]);
  const now = Date.now();
  const userMessageId = crypto.randomUUID();
  const rootMessage: GroupMessage = {
    id: userMessageId,
    role: "user",
    participantId: null,
    content: input.prompt,
    timestamp: now,
    rootMessageId: null,
    parentMessageId: null,
    depth: 0,
  };
  await saveMessages(input.threadId, [rootMessage]);

  const fullPrompt = input.promptPrefix ? `${input.promptPrefix}${input.prompt}` : input.prompt;
  const chatRunId = crypto.randomUUID();
  const payload: ChatRunPayload = {
    threadId: input.threadId,
    prompt: fullPrompt,
    projectContext,
    mentionedIds: [],
    initialParallelIds: [],
    maxRounds: Math.min(Math.max(input.maxRounds ?? 10, 1), 50),
    recentHistory: [],
    currentUserMessageId: userMessageId,
    rootMessageId: userMessageId,
    participantIds: [agent.id],
  };

  await createChatRun({
    id: chatRunId,
    threadId: input.threadId,
    rootMessageId: userMessageId,
    userId: LOCAL_USER.id,
    projectSlug: scopedProjectSlug || null,
    maxSteps: payload.maxRounds,
    activeParticipantIds: [agent.id],
    payload: payload as unknown as Record<string, unknown>,
  });

  await ensureOrchestratorRuntime();
  const queue = await getQueue();
  await queue.send<ChatRunJobData>(QUEUE_NAMES.CHAT_RUN_PROCESS, {
    chatRunId,
    userId: LOCAL_USER.id,
    signal: "start",
  });

  return { chatRunId, userMessageId };
}

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { v5 as uuidv5 } from "uuid";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { useTrackerParticipants } from "@/hooks/useTrackerParticipants";
import type { ComposerRoutingMetadata } from "@/lib/chat/composer-routing";
import type { GithubPr } from "@/lib/github-types";
import type { GroupMessage } from "@/lib/types";

const Composer = dynamic(
  () => import("@/components/chat-ui/Composer").then((m) => m.Composer),
  { ssr: false }
);

// Deterministic namespace for PR-scoped chat threads. Combined with the PR id
// (e.g. "owner/repo#123") via UUIDv5 to produce a stable, opaque threadId.
const AGX_PR_NS = "6b1c08a3-3d48-4a8d-9d60-6b9c6f8f5a01";

export function prThreadId(prId: string): string {
  return uuidv5(prId, AGX_PR_NS);
}

interface Props {
  pr: GithubPr;
  projectId?: string;
  projectSlug?: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PrSessionList({
  messages,
  participants,
}: {
  messages: GroupMessage[];
  participants: { id: string; name: string }[];
}) {
  const participantName = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  // One "session" per root message id. Root messages are user messages that
  // started a chat turn; replies hang off them.
  const sessions = useMemo(() => {
    const roots: GroupMessage[] = [];
    const replyCount = new Map<string, number>();
    const lastAt = new Map<string, number>();
    const lastAgent = new Map<string, string | null>();
    for (const m of messages) {
      if (!m.rootMessageId) {
        roots.push(m);
        if (!lastAt.has(m.id) || (lastAt.get(m.id) ?? 0) < m.timestamp) {
          lastAt.set(m.id, m.timestamp);
        }
      } else {
        replyCount.set(m.rootMessageId, (replyCount.get(m.rootMessageId) ?? 0) + 1);
        const prev = lastAt.get(m.rootMessageId) ?? 0;
        if (m.timestamp > prev) {
          lastAt.set(m.rootMessageId, m.timestamp);
          if (m.participantId) lastAgent.set(m.rootMessageId, m.participantId);
        }
      }
    }
    return roots
      .map((r) => ({
        id: r.id,
        text: r.content,
        replyCount: replyCount.get(r.id) ?? 0,
        updatedAt: lastAt.get(r.id) ?? r.timestamp,
        agent: lastAgent.get(r.id) ?? null,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [messages]);

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-neutral-500">
        No sessions yet. Start one below.
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex w-full items-start justify-between gap-3 border-b border-neutral-800/60 px-4 py-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-100">
              {s.text.length > 80 ? s.text.slice(0, 80) + "…" : s.text || "(empty)"}
            </p>
            <p className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
              {s.agent && <span>{participantName.get(s.agent) ?? s.agent}</span>}
              {s.agent && <span>·</span>}
              <span>{s.replyCount} repl{s.replyCount === 1 ? "y" : "ies"}</span>
              <span>·</span>
              <span>{formatTime(s.updatedAt)}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PrComposerPanel({ pr, projectId, projectSlug }: Props) {
  const threadId = useMemo(() => prThreadId(pr.id), [pr.id]);
  const { participants } = useTrackerParticipants("linear", projectId);
  const defaultAgent = participants[0];

  const {
    messages,
    setMessages,
    sendMessage,
    loadHistory,
    chatRuns,
    stop,
  } = useGroupChat(threadId);

  const { processes } = useProcessPolling(
    { workspaceId: threadId },
    { messages, setMessages }
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, threadId]);

  const firstSendRef = useRef(true);
  useEffect(() => {
    firstSendRef.current = messages.length === 0;
  }, [messages.length]);

  const activeRunStatuses = useMemo(
    () => new Set(["queued", "running", "awaiting_user", "blocked"]),
    []
  );
  const isWorking =
    chatRuns.some((entry) => activeRunStatuses.has(entry.status)) ||
    processes.some((p) => p.state === "spawning" || p.state === "running");
  const activityStatus: "ready" | "queued" | "working" = isWorking
    ? chatRuns.some((e) => e.status === "queued")
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
      const agent =
        (pinnedParticipantId
          ? participants.find((p) => p.id === pinnedParticipantId)
          : null) ?? defaultAgent;
      if (!agent) return;

      // Inject PR context on the very first message of the thread so the
      // agent knows what PR we're discussing.
      const prContextPrefix = firstSendRef.current
        ? `Regarding PR ${pr.repoId}#${pr.number} (${pr.title}). URL: ${pr.url}\n\n`
        : "";
      const combinedPrefix = prContextPrefix + (promptPrefix ?? "");

      void sendMessage(
        message,
        maxRounds,
        undefined,
        undefined,
        attachmentIds,
        undefined,
        [agent.id],
        projectSlug,
        combinedPrefix || undefined,
        routing
      );
      firstSendRef.current = false;
    },
    [pr, participants, defaultAgent, sendMessage, projectSlug]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PrSessionList messages={messages} participants={participants} />
      </div>
      <div className="shrink-0 border-t border-neutral-800 p-2">
        <Composer
          onSend={handleSend}
          onStop={stop}
          participants={participants}
          projectId={projectId}
          projectSlug={projectSlug}
          loading={activityStatus !== "ready"}
          commands={[]}
          activityStatus={activityStatus}
          placeholder="Ask agents about this PR…"
          initialPinnedParticipantId={defaultAgent?.id}
        />
      </div>
    </div>
  );
}

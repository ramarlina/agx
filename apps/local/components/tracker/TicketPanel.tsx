"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileText, Hash, Play } from "lucide-react";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { TicketRecapSection } from "./TicketRecapSection";
import { TicketSessionList } from "./TicketSessionList";
import { LinkedPrsSection } from "./LinkedPrsSection";
import { IssueStatusSelect, type FilterOption } from "./TrackerBoardFilters";
import type { TrackerItem } from "@/lib/tracker/types";
import type { TrackerRunRecord } from "@/lib/tracker/tracker-run-store";
import type { Participant } from "@/lib/types";
import type { ComposerRoutingMetadata } from "@/lib/chat/composer-routing";
import { buildTrackerExecutionPrompt } from "@/lib/tracker/tracker-execution-prompt";
import { useTrackerItemMetadata } from "@/hooks/useTrackerItemMetadata";

const Composer = dynamic(
  () => import("@/components/chat-ui/Composer").then((m) => m.Composer),
  { ssr: false }
);

function createThreadId() {
  return globalThis.crypto?.randomUUID?.() ?? `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface Props {
  item: TrackerItem;
  trackerType: string;
  runs: TrackerRunRecord[];
  participants: Participant[];
  projectId?: string;
  projectSlug?: string;
  itemStatusOptions: FilterOption[];
  itemStatusUpdating: boolean;
  onItemStatusChange: (item: TrackerItem, status: string) => void;
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
    mode: TrackerRunRecord["mode"];
  }) => Promise<{ run: TrackerRunRecord; recapContent: string | null }>;
  updateRun: (
    id: string,
    input: {
      rootMessageId?: string | null;
      chatRunId?: string | null;
      status?: TrackerRunRecord["status"];
      error?: string | null;
    }
  ) => Promise<TrackerRunRecord>;
  onRunCreated: (runId: string) => void;
  onSelectRun: (runId: string) => void;
}

export function TicketPanel({
  item,
  trackerType,
  runs,
  participants,
  projectId,
  projectSlug,
  itemStatusOptions,
  itemStatusUpdating,
  onItemStatusChange,
  activeSessionScriptLabel,
  onOpenSessionScripts,
  onStartScriptedSession,
  createRun,
  updateRun,
  onRunCreated,
  onSelectRun,
}: Props) {
  const defaultAgent = participants[0];
  const { metadata } = useTrackerItemMetadata(trackerType, projectId, item.id);
  const sessionScriptButtonLabel =
    activeSessionScriptLabel === "AGX default" ? "Session script" : activeSessionScriptLabel;

  const threadIdRef = useRef<string | null>(null);
  if (!threadIdRef.current) {
    threadIdRef.current = createThreadId();
  }
  const { messages, setMessages, chatRuns } = useGroupChat(threadIdRef.current);
  const { processes } = useProcessPolling(
    { workspaceId: threadIdRef.current },
    { messages, setMessages }
  );

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

  const creatingRef = useRef(false);


  const handleSend = useCallback(
    async (
      message: string,
      _maxRounds: number,
      _attachmentIds?: string[],
      _attachments?: unknown[],
      pinnedParticipantId?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      if (creatingRef.current) return;
      creatingRef.current = true;

      const agent =
        (pinnedParticipantId
          ? participants.find((p) => p.id === pinnedParticipantId)
          : null) ?? defaultAgent;
      if (!agent) {
        creatingRef.current = false;
        return;
      }

      try {
        const { run, recapContent } = await createRun({
          projectId: projectId ?? null,
          projectSlug: projectSlug ?? null,
          issueId: item.id,
          issueIdentifier: item.identifier,
          issueTitle: item.title,
          issueStatus: item.status,
          issueAssignee: item.assignee?.name ?? null,
          agentId: agent.id,
          agentName: agent.name,
          mode: "chat",
        });

        const { promptPrefix: ticketPrefix } = buildTrackerExecutionPrompt({
          issue: {
            identifier: item.identifier,
            title: item.title,
            status: item.status,
            assignee: item.assignee?.name ?? null,
          },
          project: projectSlug ? { slug: projectSlug } : null,
          runtime: { recapContent },
        });

        let prContext = "";
        if (
          trackerType === "github" &&
          (item.labels ?? []).includes("pr") &&
          projectId
        ) {
          try {
            const ctxRes = await fetch("/api/github/prs/context", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId, prId: item.id }),
            });
            if (ctxRes.ok) {
              const ctxPayload = (await ctxRes.json()) as { context?: string };
              if (ctxPayload.context) prContext = ctxPayload.context;
            }
          } catch (err) {
            console.warn("Failed to fetch PR context", err);
          }
        }

        const combinedPrefix =
          ticketPrefix +
          (prContext ? `\n\n${prContext}` : "") +
          (promptPrefix ? `\n${promptPrefix}` : "");

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
    [item, participants, defaultAgent, projectId, projectSlug, trackerType, createRun, updateRun, onRunCreated]
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--card-border)] px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-sm text-[var(--muted-foreground)]">
            {item.identifier}
          </span>
          <div className="h-1 w-1 shrink-0 rounded-full bg-[var(--card-border)]" />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {item.title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IssueStatusSelect
            status={item.status}
            options={itemStatusOptions}
            disabled={itemStatusOptions.length === 0}
            updating={itemStatusUpdating}
            onChange={(status) => onItemStatusChange(item, status)}
          />
          {metadata.estimate != null && (
            <span
              className="flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-xs font-medium text-[var(--foreground)]"
              title="Estimate"
            >
              <Hash size={12} />
              {metadata.estimate}
            </span>
          )}
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
            onClick={onOpenSessionScripts}
            title={`Session script: ${activeSessionScriptLabel}`}
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

      <div className="min-h-0 flex-1 overflow-y-auto pb-64">
        <TicketRecapSection issueId={item.id} trackerType={trackerType} projectId={projectId} />
        {projectSlug && (
          <LinkedPrsSection
            targetType="linear_issue"
            targetId={item.identifier}
            projectSlug={projectSlug}
          />
        )}
        <TicketSessionList runs={runs} onSelect={onSelectRun} />
      </div>

      <div className="absolute bottom-3 left-3 right-3 p-2">
        <Composer
          onSend={handleSend}
          onStop={() => {}}
          participants={participants}
          projectId={projectId ?? undefined}
          projectSlug={projectSlug ?? undefined}
          loading={activityStatus !== "ready"}
          commands={[]}
          activityStatus={activityStatus}
          placeholder={`Ask about ${item.identifier}...`}
          initialPinnedParticipantId={defaultAgent?.id}
        />
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { LinearIssue } from "@/hooks/useLinearIssues";
import type { TaskGroup } from "@/hooks/useTaskGroups";
import type { Participant } from "@/lib/types";
import type { ComposerRoutingMetadata } from "@/lib/chat/composer-routing";
import { useLinearRuns } from "@/hooks/useLinearRuns";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { TicketRow } from "./TicketRow";
import { TicketRecapSection } from "./TicketRecapSection";
import { TicketSessionList } from "./TicketSessionList";

const Composer = dynamic(
  () => import("@/components/chat-ui/Composer").then((m) => m.Composer),
  { ssr: false }
);

function createThreadId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

interface GroupPanelProps {
  group: TaskGroup;
  issues: LinearIssue[];
  participants: Participant[];
  projectId?: string;
  projectSlug?: string;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
  onSelectIssue: (issueId: string) => void;
  onRunCreated: (runId: string) => void;
  onSelectRun: (runId: string) => void;
}

export function GroupPanel({
  group,
  issues,
  participants,
  projectId,
  projectSlug,
  onUpdateName,
  onDelete,
  onSelectIssue,
  onRunCreated,
  onSelectRun,
}: GroupPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) {
      onUpdateName(trimmed);
    }
    setEditing(false);
  }, [editName, group.name, onUpdateName]);

  const groupIssues = issues.filter((issue) =>
    group.task_ids.includes(issue.id)
  );

  const { runs, createRun, updateRun } = useLinearRuns(
    group.id,
    projectId ?? null
  );

  const defaultAgent = participants[0];

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
        const { run } = await createRun({
          projectId: projectId ?? null,
          projectSlug: projectSlug ?? null,
          issueId: group.id,
          issueIdentifier: group.name,
          issueTitle: group.name,
          issueStatus: "active",
          issueAssignee: null,
          agentId: agent.id,
          agentName: agent.name,
          mode: "chat",
        });

        const ticketList =
          groupIssues.length > 0
            ? groupIssues
                .map(
                  (issue) =>
                    `- ${issue.identifier}: ${issue.title} (${issue.status})`
                )
                .join("\n")
            : "- (no tickets assigned to this group)";

        const groupPrefix =
          [
            "GROUP SESSION",
            `You are working on a group of related tickets named "${group.name}".`,
            `TICKETS IN THIS GROUP:\n${ticketList}`,
            "Work through these tickets as a coherent unit of work.",
          ].join("\n\n") +
          "\n\n" +
          (promptPrefix ?? "");

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: message,
            promptPrefix: groupPrefix,
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
        console.error("Failed to create group chat session:", error);
        creatingRef.current = false;
        if (error instanceof Error) {
          window.alert(error.message);
        }
      }
    },
    [
      group,
      groupIssues,
      participants,
      defaultAgent,
      projectId,
      projectSlug,
      createRun,
      updateRun,
      onRunCreated,
    ]
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--card-border)] px-4">
        <FolderOpen
          size={16}
          className="shrink-0 text-[var(--muted-foreground)]"
        />
        {editing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveName();
              if (e.key === "Escape") {
                setEditName(group.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--foreground)] outline-none border-b border-[var(--primary)]"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
            {group.name}
          </h3>
        )}
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          onClick={() => {
            setEditName(group.name);
            setEditing(true);
          }}
          title="Rename group"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
          onClick={onDelete}
          title="Delete group (ungroups tickets)"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-64">
        {/* Ticket list */}
        <section className="border-b border-[var(--card-border)]">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Tickets ({groupIssues.length})
          </div>
          {groupIssues.length === 0 ? (
            <div className="px-4 pb-4 text-center text-xs text-[var(--muted-foreground)]">
              No tickets in this group.
            </div>
          ) : (
            groupIssues.map((issue) => (
              <TicketRow
                key={issue.id}
                issue={issue}
                selected={false}
                onSelect={() => onSelectIssue(issue.id)}
              />
            ))
          )}
        </section>

        <TicketRecapSection issueId={group.id} />
        <TicketSessionList runs={runs} onSelect={onSelectRun} />
      </div>

      {/* Composer */}
      {participants.length > 0 && (
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
            placeholder={`Work on tickets in "${group.name}"...`}
            initialPinnedParticipantId={defaultAgent?.id}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Check, ExternalLink, Link2 } from "lucide-react";
import type { LinearIssue } from "@/hooks/useLinearIssues";
import type { Participant } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/linear-run-status";
import { agentAvatarUrl, openLinearIssueTab } from "@/lib/linear-board-utils";

export function TicketRow({
  issue,
  selected,
  onSelect,
  activeAgents,
  participants,
}: {
  issue: LinearIssue;
  selected: boolean;
  onSelect: () => void;
  activeAgents?: Array<{ agentId: string; agentName: string }>;
  participants?: Participant[];
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyUrl = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!issue.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issue.url);
      setCopied(true);
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1500) as unknown as number;
    } catch (error) {
      console.error("Failed to copy Linear issue URL:", error);
      setCopied(false);
    }
  }, [issue.url]);

  const handleOpenIssue = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!issue.url) {
      return;
    }
    openLinearIssueTab(issue.url);
  }, [issue.url]);

  const shortStatus = STATUS_LABELS[issue.status] ?? issue.status.slice(0, 6);
  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        selected
          ? "bg-[var(--card-bg)]"
          : "hover:bg-[var(--card-bg)]/50"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full bg-blue-500" />
      )}
      <span className="w-24 shrink-0 whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
        {issue.identifier}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${selected ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
        {issue.title}
      </span>
      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
        {shortStatus}
      </span>
      {activeAgents && activeAgents.length > 0 && (
        <span className="inline-flex items-center -space-x-1 shrink-0">
          {activeAgents.slice(0, 3).map((agent) => {
            const participant = participants?.find((p) => p.id === agent.agentId);
            return (
              <span key={agent.agentId} className="relative inline-block" title={participant?.name ?? agent.agentName}>
                <img src={agentAvatarUrl(agent.agentId, participant?.color, 16)} alt={participant?.name ?? agent.agentName} className="h-3 w-3 rounded-full ring-[1.5px] ring-[var(--app-shell-pane)]" />
                <span className="absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full bg-green-500 ring-[1px] ring-[var(--app-shell-pane)]" />
              </span>
            );
          })}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${issue.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={(event) => {
            void handleCopyUrl(event);
          }}
          title={copied ? "Copied ticket URL" : "Copy ticket URL"}
          aria-label={copied ? "Copied ticket URL" : "Copy ticket URL"}
          disabled={!issue.url}
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Link2 size={10} />}
        </button>
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${issue.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={handleOpenIssue}
          title={issue.url ? "Open this Linear ticket in a new tab" : "This ticket does not have a Linear URL"}
          aria-label={issue.url ? "Open this Linear ticket in a new tab" : "This ticket does not have a Linear URL"}
          disabled={!issue.url}
        >
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
}

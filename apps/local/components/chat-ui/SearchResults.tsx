"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Bot, SearchX, User } from "lucide-react";
import type { MessageSearchResult, Participant } from "@/lib/types";
import { agentAvatarUrl } from "./ParticipantBar";

interface SearchResultsProps {
  query: string;
  results: MessageSearchResult[];
  total: number;
  participants: Participant[];
  threadTitleById: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  onSelectResult: (result: MessageSearchResult) => void;
  headerSlot?: ReactNode;
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function renderSnippet(snippet: string): ReactNode[] {
  const parts = snippet.split(/(<\/?mark>)/g);
  let highlighted = false;
  const nodes: ReactNode[] = [];

  for (const [index, part] of parts.entries()) {
    if (part === "<mark>") {
      highlighted = true;
      continue;
    }
    if (part === "</mark>") {
      highlighted = false;
      continue;
    }
    if (!part) continue;
    nodes.push(
      highlighted ? (
        <mark key={`${index}-mark`} className="rounded bg-amber-200/80 px-0.5">
          {part}
        </mark>
      ) : (
        <span key={`${index}-text`}>{part}</span>
      )
    );
  }

  return nodes;
}

export function SearchResults({
  query,
  results,
  total,
  participants,
  threadTitleById,
  isLoading,
  error,
  onSelectResult,
  headerSlot,
}: SearchResultsProps) {
  const participantMap = Object.fromEntries(participants.map((participant) => [participant.id, participant]));

  return (
    <div className="chat-scrollbar flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        {headerSlot ? (
          <div className="sticky top-0 z-20 bg-[var(--app-shell-subtle)]/70 backdrop-blur-md pt-4 pb-6 px-4 -mx-4 border-b border-transparent transition-colors">
            <div className="max-w-2xl mx-auto">
              {headerSlot}
            </div>
          </div>
        ) : null}
        <div className="mb-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--foreground)]">Search results</div>
          <div className="mt-1 text-sm text-[var(--muted-foreground)]">
            {isLoading ? "Searching…" : `${total} result${total === 1 ? "" : "s"} for "${query}"`}
          </div>
          {error ? <div className="mt-2 text-sm text-rose-600">{error}</div> : null}
        </div>

        {!isLoading && !error && results.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center space-y-2 text-[var(--app-shell-muted)]">
            <SearchX className="h-6 w-6" strokeWidth={1.5} />
            <p className="text-sm font-medium">No matching messages</p>
          </div>
        ) : null}

        <div className="space-y-3 pb-6">
          {results.map((result) => {
            const participant = result.participantId ? participantMap[result.participantId] : null;
            const threadTitle = threadTitleById[result.threadId] || "Untitled thread";
            const authorName = result.role === "user" ? "You" : participant?.name || result.participantId || "Assistant";

            return (
              <button
                key={`${result.threadId}-${result.messageId}`}
                type="button"
                onClick={() => onSelectResult(result)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-4 text-left transition hover:border-[var(--border)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--muted)]">
                      {result.role === "user" ? (
                        <User className="h-4 w-4 text-[var(--foreground)]" />
                      ) : participant ? (
                        <Link href={`/agents/${participant.id}`} onClick={(e) => e.stopPropagation()} className="h-full w-full hover:ring-2 hover:ring-blue-300 rounded-full transition-shadow">
                          <img
                            src={agentAvatarUrl(participant.id, 32, participant.color)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </Link>
                      ) : (
                        <Bot className="h-4 w-4 text-[var(--foreground)]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      {result.role !== "user" && participant ? (
                        <Link href={`/agents/${participant.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-semibold text-[var(--foreground)] hover:underline block">{authorName}</Link>
                      ) : (
                        <p className="truncate text-sm font-semibold text-[var(--foreground)]">{authorName}</p>
                      )}
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{threadTitle}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{formatTimestamp(result.timestamp)}</span>
                </div>
                <p className="text-sm leading-relaxed text-[var(--foreground)]">{renderSnippet(result.snippet)}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

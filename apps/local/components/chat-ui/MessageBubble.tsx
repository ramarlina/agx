"use client";

import type { GroupMessage } from "@/lib/types";
import { Markdown } from "./Markdown";
import { agentAvatarUrl } from "./ParticipantBar";
import { MessageReactionsBar } from "./MessageReactionsBar";
import { MessageAttachments } from "./MessageAttachments";
import { MessageSquare, User, FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { stripMarkers } from "@/lib/chat-utils";

interface Props {
  message: GroupMessage;
  participantName?: string;
  participantColor?: string;
  participantId?: string;
  onReply?: (messageId: string) => void;
  onOpenThread?: (rootMessageId: string) => void;
  onSummarize?: (rootMessageId: string) => void;
  summarizing?: boolean;
  isRoot?: boolean;
  highlighted?: boolean;
  hideUserAvatarAndName?: boolean;
}

export function MessageBubble({
  message,
  participantName,
  participantColor,
  participantId,
  onReply,
  onOpenThread,
  onSummarize,
  summarizing,
  isRoot = false,
  highlighted = false,
  hideUserAvatarAndName = false,
}: Props) {
  const isUser = message.role === "user";
  const cleanContent = stripMarkers(message.content);

  // Hide messages that only contained agx markers
  if (!cleanContent && !message.attachments?.length) return null;

  const formatTimestamp = (ts: number) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(ts);
  };

  return (
    <div
      className={`flex gap-4 group transition-colors ${!isRoot ? "py-4" : ""} ${highlighted ? "rounded-lg bg-amber-50/90 px-2 -mx-2 ring-1 ring-amber-200" : ""
        }`}
    >
      {!(isUser && hideUserAvatarAndName) && (
        participantId && !isUser ? (
          <Link href={`/agents/${participantId}`} className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--muted)] overflow-hidden hover:ring-2 hover:ring-blue-300 transition-shadow`}>
            <img src={agentAvatarUrl(participantId, 36, participantColor)} alt="" className="w-full h-full object-cover" />
          </Link>
        ) : (
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-[var(--muted)] text-[var(--muted-foreground)]' : 'bg-[var(--muted)] overflow-hidden'}`}>
            <User className="w-5 h-5" />
          </div>
        )
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          {!(isUser && hideUserAvatarAndName) && (
            !isUser && participantId ? (
              <Link
                href={`/agents/${participantId}`}
                className="font-bold text-[15px] hover:underline"
                style={participantColor ? { color: participantColor } : {}}
              >
                {participantName || "Unknown"}
              </Link>
            ) : (
              <span className="font-bold text-[15px]">
                {isUser ? "You" : (participantName || "Unknown")}
              </span>
            )
          )}
          <span className="text-xs text-[var(--muted-foreground)] font-medium">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        <div
          className={`text-[15px] text-[var(--foreground)] leading-relaxed ${isUser ? "cursor-pointer hover:bg-[var(--app-shell-subtle)]/50 transition-colors rounded p-1 -mx-1" : ""}`}
          onClick={() => {
            if (isUser && onOpenThread) {
              onOpenThread(message.id);
            }
          }}
        >
          <Markdown content={cleanContent} isUser={isUser} />
          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments attachments={message.attachments} />
          )}
        </div>

        {isRoot && (
          <div className="mt-4 flex gap-2">
            <MessageReactionsBar reactions={message.reactions} />

            {onReply && !isUser && (
              <button
                type="button"
                onClick={() => onReply(message.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--app-shell-subtle)] transition-colors text-xs font-semibold"
              >
                <MessageSquare className="w-3 h-3" />
                Reply
              </button>
            )}
            {onSummarize && (
              <button
                type="button"
                onClick={() => onSummarize(message.id)}
                disabled={summarizing}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--app-shell-subtle)] transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {summarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                {summarizing ? "Summarizing…" : "Summarize"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

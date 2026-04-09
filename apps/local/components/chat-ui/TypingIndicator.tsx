"use client";

import Link from "next/link";
import { Markdown } from "./Markdown";
import { agentAvatarUrl } from "./ParticipantBar";
import { stripMarkers } from "@/lib/chat-utils";

interface Props {
  participantId: string;
  participantName: string;
  participantColor: string;
  content: string;
}

function PulsatingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] ml-1">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
    </span>
  );
}

export function TypingIndicator({
  participantId,
  participantName,
  participantColor,
  content,
}: Props) {
  const cleanContent = stripMarkers(content);
  const hasContent = cleanContent.length > 0;

  return (
    <div className="flex gap-4 py-4 group transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Link href={`/agents/${participantId}`} className="w-9 h-9 rounded-full bg-[var(--muted)] overflow-hidden shrink-0 shadow-sm border border-[var(--border)] hover:ring-2 hover:ring-blue-300 transition-shadow">
        <img src={agentAvatarUrl(participantId, 36, participantColor)} alt="" className="w-full h-full object-cover" />
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <Link href={`/agents/${participantId}`} className="font-bold text-[15px] hover:underline" style={{ color: participantColor }}>
            {participantName}
          </Link>
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            Streaming
          </span>
        </div>

        <div className="text-[15px] text-[var(--foreground)] leading-relaxed min-h-[1.5rem] flex items-center">
          {hasContent ? (
            <div className="flex-1">
              <Markdown content={cleanContent} />
              <span className="inline-flex items-baseline ml-0.5">
                <span className="w-1 h-1 rounded-full bg-indigo-400 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[var(--muted-foreground)] italic">
              <span className="text-sm font-medium">working</span>
              <PulsatingDots />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { DEMO_MESSAGES, DEMO_PARTICIPANTS } from "@/lib/demo-threads";
import { agentAvatarUrl } from "./ParticipantBar";
import { Markdown } from "./Markdown";
import { User } from "lucide-react";

const STAGGER_MS = 400;

export function ChatPreview() {
  const [visibleCount, setVisibleCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visibleCount >= DEMO_MESSAGES.length) return;
    const timer = setTimeout(() => {
      setVisibleCount((c) => c + 1);
    }, visibleCount === 0 ? 300 : STAGGER_MS);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  useEffect(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleCount]);

  const participantMap = Object.fromEntries(
    DEMO_PARTICIPANTS.map((p) => [p.id, p])
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="max-w-2xl mx-auto space-y-4">
        {DEMO_MESSAGES.slice(0, visibleCount).map((msg, i) => {
          const isUser = msg.role === "user";
          const p = msg.participantId ? participantMap[msg.participantId] : null;

          return (
            <div
              key={msg.id}
              className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="w-8 h-8 rounded-full overflow-hidden border border-[var(--border)] shadow-sm shrink-0 mt-0.5 flex items-center justify-center bg-[var(--muted)]">
                {isUser ? (
                  <User className="w-4 h-4 text-[var(--muted-foreground)]" />
                ) : p ? (
                  <Link href={`/agents/${p.id}`} className="w-full h-full hover:ring-2 hover:ring-blue-300 rounded-full transition-shadow">
                    <img
                      src={agentAvatarUrl(p.id, 32, p.color)}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  </Link>
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  {!isUser && p ? (
                    <Link
                      href={`/agents/${p.id}`}
                      className="text-[12px] font-bold tracking-wide uppercase hover:underline"
                      style={{ color: p.color || "#64748b" }}
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span
                      className="text-[12px] font-bold tracking-wide uppercase"
                      style={{ color: isUser ? "#334155" : "#64748b" }}
                    >
                      {isUser ? "You" : "Agent"}
                    </span>
                  )}
                  {!isUser && p?.model && (
                    <span className="text-[10px] text-[var(--muted-foreground)] font-medium">
                      {p.model}
                    </span>
                  )}
                </div>
                <div className="text-[14px] text-[var(--foreground)] leading-relaxed mt-0.5">
                  <Markdown content={msg.content} isUser={isUser} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

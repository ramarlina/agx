"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskTerminalStream } from "@/hooks/useTasks";
import { parseAnsiSegments } from "@/lib/ansi";

interface TerminalLogStreamProps {
  taskId: string;
  status?: string | null;
}

export default function TerminalLogStream({ taskId, status }: TerminalLogStreamProps) {
  // Default closed: task details should not freeze the whole page by rendering/parsing large logs.
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { output, isLoading, isStreaming } = useTaskTerminalStream(taskId, {
    enabled: isOpen,
    tail: 500,
    maxChars: 200_000,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    // Only auto-scroll if we are already near the bottom or if it's the initial load
    // For now, keeping simple behavior: scroll to bottom on update
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [output, isOpen]);

  const displayText = output
    ? output
    : isLoading
        ? "Loading logs..."
        : status === "in_progress"
            ? "Waiting for live output..."
            : "No output yet.";
  const segments = useMemo(
    () => (isOpen ? parseAnsiSegments(displayText) : []),
    [displayText, isOpen]
  );

  return (
    <div className="border-t border-[var(--card-border)] pt-8">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <span>Terminal Stream</span>
          {isStreaming && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--status-completed-bg)] text-[var(--status-completed)] border border-[var(--status-completed-border)]">
              Live
            </span>
          )}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {isOpen ? "Collapse" : "Expand"}
        </span>
      </button>

      {isOpen && (
        <div className="mt-4 rounded-lg border border-[var(--card-border)] bg-[var(--muted)] transition-all duration-300 ease-in-out">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--card-border)] text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">
            <span>Run Log</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px]">
                {isStreaming ? "Streaming" : "Idle"}
              </span>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="hover:text-[var(--foreground)] transition-colors p-1"
                title={isExpanded ? "Collapse View" : "Expand View"}
              >
                {isExpanded ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 3h6v6" />
                    <path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div
            ref={scrollRef}
            className={`${
              isExpanded ? "max-h-[70vh]" : "max-h-64"
            } overflow-y-auto px-3 py-3 font-mono text-xs text-[var(--foreground)] whitespace-pre-wrap leading-relaxed transition-all duration-300 ease-in-out`}
          >
            {segments.map((segment, index) => (
              <span key={`${index}-${segment.text.length}`} style={segment.style}>
                {segment.text}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

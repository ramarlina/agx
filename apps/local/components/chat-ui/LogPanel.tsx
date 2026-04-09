"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LogEntry } from "@/hooks/useGroupChat";
import type { Participant } from "@/lib/types";

interface Props {
  logs: LogEntry[];
  participants: Participant[];
  onClear: () => void;
  open: boolean;
  onToggle: () => void;
}

export function LogPanel({ logs, participants, onClear, open, onToggle }: Props) {
  const [width, setWidth] = useState(420);
  const [filter, setFilter] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const pMap = Object.fromEntries(participants.map((p) => [p.id, p]));

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length, open]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startX.current - e.clientX;
    setWidth(Math.max(280, Math.min(startW.current + delta, window.innerWidth * 0.6)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!open) return null;

  const filtered = filter ? logs.filter((l) => l.participantId === filter) : logs;

  return (
    <div className="flex h-full shrink-0">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="w-1.5 cursor-col-resize bg-zinc-800 hover:bg-zinc-600 transition-colors flex items-center justify-center shrink-0"
      >
        <div className="h-8 w-0.5 rounded-full bg-zinc-500" />
      </div>
      <div className="flex flex-col bg-zinc-950 h-full" style={{ width }}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
          <span className="text-[11px] text-[var(--muted-foreground)] font-mono">Logs</span>
          <select
            value={filter || ""}
            onChange={(e) => setFilter(e.target.value || null)}
            className="bg-zinc-800 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none"
          >
            <option value="">All</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClear}
              className="text-[11px] text-[var(--muted-foreground)] hover:text-zinc-300"
            >
              Clear
            </button>
            <button
              onClick={onToggle}
              className="text-[11px] text-[var(--muted-foreground)] hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-4 px-3 py-2">
          {filtered.map((entry, i) => {
            const name = pMap[entry.participantId]?.name || entry.participantId;
            const color = pMap[entry.participantId]?.color || "#888";
            const isErr = entry.stream === "stderr";
            return (
              <div key={i} className="flex gap-2 whitespace-pre-wrap break-all">
                <span className="text-[var(--muted-foreground)] shrink-0 select-none">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="shrink-0" style={{ color }}>{name}</span>
                <span className={isErr ? "text-red-400" : "text-[var(--muted-foreground)]"}>
                  {entry.line}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

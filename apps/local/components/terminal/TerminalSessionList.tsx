"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X, Terminal, Search } from "lucide-react";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import {
  getTerminalSessionStatus,
  type TerminalStatus,
  type TerminalSession,
} from "@/lib/terminal-types";

interface TerminalSessionListProps {
  sessions: TerminalSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCreate: () => void;
}


function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusDotClass(status: TerminalStatus): string {
  if (status === "active") return "bg-emerald-400";
  if (status === "connecting") return "bg-amber-400";
  if (status === "error") return "bg-rose-500";
  return "bg-zinc-500";
}

function terminalCountLabel(count: number): string {
  return `${count} terminal${count === 1 ? "" : "s"}`;
}

export default function TerminalSessionList({
  sessions,
  selectedId,
  onSelect,
  onClose,
  onRename,
  onCreate,
}: TerminalSessionListProps) {
  const { isTouchLayout } = useInputCapabilities();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (session: TerminalSession) => {
    setEditingId(session.id);
    setEditValue(session.title);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase().trim();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.terminals.some(
          (terminal) =>
            terminal.title.toLowerCase().includes(q) ||
            terminal.cwd?.toLowerCase().includes(q) ||
            terminal.command?.toLowerCase().includes(q),
        ),
    );
  }, [sessions, search]);

  return (
    <div className="flex h-full flex-col border-r border-[var(--app-shell-border)] bg-[var(--background)]">
      {/* Header + search */}
      <div className="px-6 pb-0 pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[14px] font-semibold text-[var(--foreground)]">
            Sessions
          </span>
          <button
            type="button"
            onClick={onCreate}
            className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            title="New terminal session"
            aria-label="New terminal session"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full rounded-md border border-[var(--card-border)] bg-transparent py-1.5 pl-8 pr-7 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none transition-colors focus:border-[var(--foreground)]/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--muted-foreground)]">
            {sessions.length === 0
              ? "No sessions. Click + to create one."
              : "No sessions match your search."}
          </div>
        ) : (
          <div className="overflow-hidden">
            {filteredSessions.map((session) => {
              const isSelected = session.id === selectedId;
              const isEditing = session.id === editingId;
              const status = getTerminalSessionStatus(session);

              return (
                <div
                  key={session.id}
                  onClick={() => onSelect(session.id)}
                  onDoubleClick={() => startRename(session)}
                  className={`group cursor-pointer border-b border-[var(--card-border)]/50 px-6 py-3 transition-colors ${
                    isSelected
                      ? "bg-[var(--card-bg)]"
                      : "hover:bg-[var(--muted)]/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${statusDotClass(status)}`}
                      title={status}
                    />

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-full rounded border border-[var(--app-shell-border)] bg-transparent px-1 text-sm text-[var(--foreground)] outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Terminal size={12} className="shrink-0 opacity-60" />
                          <span className="truncate text-sm font-medium text-[var(--foreground)]">
                            {session.title}
                          </span>
                        </div>
                      )}

                      <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                        {terminalCountLabel(session.terminals.length)} · {timeAgo(session.createdAt)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(session.id);
                      }}
                      className={`mt-0.5 shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--app-shell-border)] hover:text-[var(--foreground)] ${
                        isSelected || isTouchLayout
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                      aria-label={`Close ${session.title}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

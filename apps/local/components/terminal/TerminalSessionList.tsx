"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X, Terminal } from "lucide-react";
import type { TerminalSession } from "@/lib/terminal-types";

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

function statusDotClass(status: TerminalSession["status"]): string {
  if (status === "active") return "bg-emerald-400";
  if (status === "connecting") return "bg-amber-400";
  return "bg-zinc-500";
}

export default function TerminalSessionList({
  sessions,
  selectedId,
  onSelect,
  onClose,
  onRename,
  onCreate,
}: TerminalSessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
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

  return (
    <div className="flex h-full flex-col border-r border-[var(--app-shell-border)] bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Terminal
        </h2>
        <button
          type="button"
          onClick={onCreate}
          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]"
          aria-label="New terminal session"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--muted-foreground)]">
            No sessions. Click + to create one.
          </div>
        ) : (
          <div className="overflow-hidden">
            {sessions.map((session) => {
              const isSelected = session.id === selectedId;
              const isEditing = session.id === editingId;

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
                      className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${statusDotClass(session.status)}`}
                      title={session.status}
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
                        {timeAgo(session.createdAt)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(session.id);
                      }}
                      className={`mt-0.5 shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--app-shell-border)] hover:text-[var(--foreground)] ${
                        isSelected
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

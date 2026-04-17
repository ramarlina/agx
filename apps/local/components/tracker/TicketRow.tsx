"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Check, ExternalLink, Link2, MessageSquare, Pin, Play, StickyNote } from "lucide-react";
import { NoteSticker } from "@/components/tracker/NoteSticker";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { TrackerItem } from "@/lib/tracker/types";
import type { Participant } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/tracker-run-status";
import { agentAvatarUrl } from "@/lib/tracker-board-utils";

export function TicketRow({
  item,
  selected,
  pinned,
  onSelect,
  onTogglePin,
  activeAgents,
  participants,
  multiSelected,
  draggable = false,
  treeConnector,
  projectSlug,
  stats,
  hideStatus,
  estimate,
  localLabels,
  labelDefinitions,
}: {
  item: TrackerItem;
  selected: boolean;
  pinned?: boolean;
  onSelect: (event?: React.MouseEvent) => void;
  onTogglePin?: () => void;
  activeAgents?: Array<{ agentId: string; agentName: string }>;
  participants?: Participant[];
  multiSelected?: boolean;
  draggable?: boolean;
  treeConnector?: "mid" | "last";
  projectSlug?: string;
  stats?: { sessions: number; messages: number };
  hideStatus?: boolean;
  estimate?: number | null;
  localLabels?: string[];
  labelDefinitions?: Array<{ name: string; color: string | null }>;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [hasNote, setHasNote] = useState(false);

  const loadNote = useCallback(async () => {
    if (!projectSlug || noteLoaded) return;
    try {
      const res = await fetch(
        `/api/tracker/notes?projectSlug=${encodeURIComponent(projectSlug)}&id=${encodeURIComponent(item.identifier)}&type=issue`
      );
      const data = await res.json() as { content: string | null };
      const content = data.content ?? "";
      setNoteContent(content);
      setHasNote(content.trim() !== "");
      setNoteLoaded(true);
    } catch {
      setNoteLoaded(true);
    }
  }, [projectSlug, item.identifier, noteLoaded]);

  const saveNote = useCallback(async (content: string) => {
    if (!projectSlug) return;
    setHasNote(content.trim() !== "");
    try {
      await fetch("/api/tracker/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug, id: item.identifier, type: "issue", content }),
      });
    } catch {
      // Silent fail — note stays in UI state
    }
  }, [projectSlug, item.identifier]);

  const handleNoteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!noteOpen) {
      void loadNote();
    }
    setNoteOpen((prev) => !prev);
  }, [noteOpen, loadNote]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyUrl = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!item.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1500) as unknown as number;
    } catch (error) {
      console.error("Failed to copy tracker item URL:", error);
      setCopied(false);
    }
  }, [item.url]);

  const handleOpenItem = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!item.url) {
      return;
    }
    window.open(item.url, "_blank");
  }, [item.url]);

  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !draggable,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: item.id,
    disabled: !draggable,
  });
  const setNodeRef = useCallback((node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  }, [setDragRef, setDropRef]);

  const shortStatus = STATUS_LABELS[item.status] ?? item.status.slice(0, 6);
  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={isDragging ? { opacity: 0.3 } : undefined}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={`group ${treeConnector ? "pl-7" : ""} relative flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        selected
          ? "bg-[var(--card-bg)]"
          : "hover:bg-[var(--card-bg)]/50"
      } ${multiSelected ? "ring-1 ring-[var(--primary)]/40 bg-[var(--primary)]/5" : ""} ${isOver && !isDragging ? "bg-[var(--primary)]/10 border-l-2 border-l-[var(--primary)]" : ""}`}
      onClick={(e) => onSelect(e)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {selected && !isOver && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full bg-blue-500" />
      )}
      {draggable && (
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
            multiSelected
              ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border-[var(--muted-foreground)]/30 opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const synth = new MouseEvent("click", { metaKey: true, ctrlKey: true }) as unknown as React.MouseEvent;
            onSelect(synth);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {multiSelected && <Check size={10} />}
        </span>
      )}
      {treeConnector && (
        <span className="shrink-0 font-mono text-[11px] leading-none text-[var(--muted-foreground)]/40 select-none">
          {treeConnector === "last" ? "└──" : "├──"}
        </span>
      )}
      <span className={`shrink-0 whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)] ${treeConnector ? "" : "w-15"}`}>
        {item.identifier}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${selected ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
        {item.title}
      </span>
      {estimate != null && (
        <span className="shrink-0 rounded-full bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
          {estimate}
        </span>
      )}
      {localLabels && localLabels.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {localLabels.slice(0, 3).map((label) => {
            const def = labelDefinitions?.find((d) => d.name === label);
            return (
              <span
                key={label}
                className="flex items-center gap-1 rounded-full border border-[var(--card-border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]"
              >
                {def?.color && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: def.color }}
                  />
                )}
                <span className="max-w-[60px] truncate">{label}</span>
              </span>
            );
          })}
          {localLabels.length > 3 && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              +{localLabels.length - 3}
            </span>
          )}
        </span>
      )}
      {!hideStatus && (
        <span className="inline-flex shrink-0 items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {shortStatus}
          </span>
          {stats && stats.sessions > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] tabular-nums text-[var(--muted-foreground)]/50"
              title={`${stats.sessions} session${stats.sessions !== 1 ? "s" : ""}, ${stats.messages} message${stats.messages !== 1 ? "s" : ""}`}
            >
              <span className="inline-flex items-center gap-0.5">
                <Play size={8} className="fill-current" />
                {stats.sessions}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare size={8} />
                {stats.messages}
              </span>
            </span>
        )}
        </span>
      )}
      {hideStatus && stats && stats.sessions > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-[var(--muted-foreground)]/50"
          title={`${stats.sessions} session${stats.sessions !== 1 ? "s" : ""}, ${stats.messages} message${stats.messages !== 1 ? "s" : ""}`}
        >
          <span className="inline-flex items-center gap-0.5">
            <Play size={8} className="fill-current" />
            {stats.sessions}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare size={8} />
            {stats.messages}
          </span>
        </span>
      )}
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
        {projectSlug && (
          <>
            <button
              ref={noteButtonRef}
              type="button"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-all hover:bg-zinc-700 ${
                hasNote
                  ? "text-amber-400 opacity-100"
                  : `text-[var(--muted-foreground)] ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`
              }`}
              onClick={handleNoteClick}
              title={hasNote ? "Edit note" : "Add note"}
              aria-label={hasNote ? "Edit note" : "Add note"}
            >
              <StickyNote size={10} className={hasNote ? "fill-current" : ""} />
            </button>
            {noteOpen && (
              <NoteSticker
                anchorRef={noteButtonRef}
                value={noteContent}
                onChange={setNoteContent}
                onClose={() => setNoteOpen(false)}
                onSave={saveNote}
              />
            )}
          </>
        )}
        {onTogglePin && (
          <button
            type="button"
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
              pinned
                ? "text-amber-400 opacity-100"
                : `text-[var(--muted-foreground)] ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            title={pinned ? "Unpin ticket" : "Pin to top"}
            aria-label={pinned ? "Unpin ticket" : "Pin to top"}
          >
            <Pin size={10} className={pinned ? "fill-current" : ""} />
          </button>
        )}
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${item.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={(event) => {
            void handleCopyUrl(event);
          }}
          title={copied ? "Copied ticket URL" : "Copy ticket URL"}
          aria-label={copied ? "Copied ticket URL" : "Copy ticket URL"}
          disabled={!item.url}
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Link2 size={10} />}
        </button>
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:bg-zinc-700 hover:text-[var(--foreground)] ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } ${item.url ? "" : "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--muted-foreground)]"}`}
          onClick={handleOpenItem}
          title={item.url ? "Open this ticket in a new tab" : "This ticket does not have an external URL"}
          aria-label={item.url ? "Open this ticket in a new tab" : "This ticket does not have an external URL"}
          disabled={!item.url}
        >
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
}

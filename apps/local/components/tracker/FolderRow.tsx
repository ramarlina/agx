"use client";

import React, { useState, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Folder, X, StickyNote } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { NoteSticker } from "@/components/tracker/NoteSticker";

interface FolderRowProps {
  groupId: string;
  name: string;
  count: number;
  collapsed: boolean;
  selected: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onUngroup?: () => void;
  projectSlug?: string;
}

export function FolderRow({
  groupId,
  name,
  count,
  collapsed,
  selected,
  onToggleCollapse,
  onSelect,
  onUngroup,
  projectSlug,
}: FolderRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });

  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [hasNote, setHasNote] = useState(false);

  const loadNote = useCallback(async () => {
    if (!projectSlug || noteLoaded) return;
    try {
      const res = await fetch(
        `/api/tracker/notes?projectSlug=${encodeURIComponent(projectSlug)}&id=${encodeURIComponent(groupId)}&type=group`
      );
      const data = await res.json() as { content: string | null };
      const content = data.content ?? "";
      setNoteContent(content);
      setHasNote(content.trim() !== "");
      setNoteLoaded(true);
    } catch {
      setNoteLoaded(true);
    }
  }, [projectSlug, groupId, noteLoaded]);

  const saveNote = useCallback(async (content: string) => {
    if (!projectSlug) return;
    setHasNote(content.trim() !== "");
    try {
      await fetch("/api/tracker/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug, id: groupId, type: "group", content }),
      });
    } catch {
      // Silent fail
    }
  }, [projectSlug, groupId]);

  const handleNoteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!noteOpen) {
      void loadNote();
    }
    setNoteOpen((prev) => !prev);
  }, [noteOpen, loadNote]);

  return (
    <div
      ref={setNodeRef}
      className={`group relative flex cursor-pointer items-center gap-2 pl-[24px] pr-4 py-2 text-sm transition-colors ${
        selected
          ? "bg-[var(--card-bg)]"
          : "hover:bg-[var(--card-bg)]/50"
      } ${isOver ? "bg-[var(--primary)]/10 border-l-2 border-l-[var(--primary)]" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full bg-blue-500" />
      )}
      <button
        type="button"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
        aria-label={collapsed ? "Expand folder" : "Collapse folder"}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      <span className="shrink-0 text-[var(--muted-foreground)]">
        {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs font-medium ${selected ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
        {name}
      </span>
      <span className="shrink-0 rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
        {count}
      </span>
      {projectSlug && (
        <>
          <button
            ref={noteButtonRef}
            type="button"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-all hover:bg-zinc-700 ${
              hasNote
                ? "text-amber-400 opacity-100"
                : "text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100"
            }`}
            onClick={handleNoteClick}
            title={hasNote ? "Edit group note" : "Add group note"}
            aria-label={hasNote ? "Edit group note" : "Add group note"}
          >
            <StickyNote size={12} className={hasNote ? "fill-current" : ""} />
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
      {onUngroup && (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onUngroup();
          }}
          title="Ungroup tickets"
          aria-label="Ungroup tickets"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

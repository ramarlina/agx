"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

interface PendingTicket {
  id: string;
  identifier: string;
  title: string;
  status?: string;
}

interface GroupNamePromptProps {
  tickets: PendingTicket[];
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export const PENDING_GROUP_DROP_ID = "__pending-group__";

function DraggableTicketRow({ ticket, isLast }: { ticket: PendingTicket; isLast: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.3 : 1, position: "relative" as const, zIndex: isDragging ? 50 : undefined }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-3 pl-[48px] pr-4 py-2 text-sm cursor-grab active:cursor-grabbing"
    >
      <span className="shrink-0 font-mono text-[11px] leading-none text-[var(--muted-foreground)]/40 select-none">
        {isLast ? "└──" : "├──"}
      </span>
      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
        {ticket.identifier}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">
        {ticket.title}
      </span>
      {ticket.status && (
        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
          {ticket.status}
        </span>
      )}
    </div>
  );
}

export function GroupNamePrompt({ tickets, onConfirm, onCancel }: GroupNamePromptProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: PENDING_GROUP_DROP_ID });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    const fallback = tickets.map((t) => t.identifier).join(", ");
    onConfirm(trimmed || fallback || "Untitled");
  }, [name, onConfirm, tickets]);

  return (
    <div ref={setNodeRef} className={`mx-0 my-0 transition-colors ${isOver ? "bg-[var(--primary)]/5" : ""}`}>
      {/* Folder header with inline name input */}
      <div className="flex items-center gap-2 pl-[24px] pr-4 py-2 bg-[var(--card-bg)]/50">
        <ChevronDown size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        <FolderOpen size={14} className="shrink-0 text-[var(--muted-foreground)]" />
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder={tickets.map((t) => t.identifier).join(", ") || "Name this group..."}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/60 outline-none border-b border-[var(--primary)]/40 pb-0.5 focus:border-[var(--primary)]"
        />
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          onClick={handleSubmit}
        >
          Create
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {/* Tree preview of grouped tickets — each row is draggable out */}
      {tickets.map((ticket, idx) => (
        <DraggableTicketRow key={ticket.id} ticket={ticket} isLast={idx === tickets.length - 1} />
      ))}
    </div>
  );
}

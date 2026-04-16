"use client";

import React from "react";
import { ChevronDown, ChevronRight, FolderOpen, Folder } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

interface FolderRowProps {
  groupId: string;
  name: string;
  count: number;
  collapsed: boolean;
  selected: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
}

export function FolderRow({
  groupId,
  name,
  count,
  collapsed,
  selected,
  onToggleCollapse,
  onSelect,
}: FolderRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId });

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
    </div>
  );
}

"use client";

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

export const STATUS_GROUP_PREFIX = "sg::";

export function StatusGroupRow({
  status,
  categoryColor,
  count,
  collapsed,
  onToggle,
}: {
  status: string;
  categoryColor: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${STATUS_GROUP_PREFIX}${status}` });

  return (
    <div
      ref={setNodeRef}
      className={`sticky top-0 z-[5] flex cursor-pointer items-center gap-2 border-b border-[var(--card-border)] bg-[var(--app-shell-pane)] px-4 py-2 transition-colors ${
        isOver ? "bg-[var(--primary)]/10 ring-1 ring-inset ring-[var(--primary)]/30" : ""
      }`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {collapsed ? (
        <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
      ) : (
        <ChevronDown size={14} className="shrink-0 text-[var(--muted-foreground)]" />
      )}
      <span className={`h-2 w-2 shrink-0 rounded-full ${categoryColor}`} />
      <span className="text-xs font-medium text-[var(--foreground)]">{status}</span>
      <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{count}</span>
    </div>
  );
}

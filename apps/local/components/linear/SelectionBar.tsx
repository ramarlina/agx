"use client";

import React from "react";
import { FolderPlus, X } from "lucide-react";

interface SelectionBarProps {
  count: number;
  onGroup: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, onGroup, onClear }: SelectionBarProps) {
  if (count < 2) return null;

  return (
    <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 shadow-2xl">
      <span className="text-xs text-[var(--muted-foreground)]">
        {count} selected
      </span>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        onClick={onGroup}
      >
        <FolderPlus size={12} />
        Group
      </button>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}

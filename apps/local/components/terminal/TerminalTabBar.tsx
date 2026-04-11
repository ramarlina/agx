"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X, Terminal } from "lucide-react";
import type { TerminalTab } from "@/lib/terminal-types";

interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
}

export default function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  onRename,
}: TerminalTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (tab: TerminalTab) => {
    setEditingId(tab.id);
    setEditValue(tab.title);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div
      className="flex items-center gap-0 overflow-x-auto border-b border-[var(--app-shell-border)] bg-[var(--background)]"
      style={{ minHeight: 36 }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = tab.id === editingId;

        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => startRename(tab)}
            className={`
              group relative flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer
              select-none shrink-0 transition-colors duration-150
              ${
                isActive
                  ? "text-[var(--foreground)] bg-[var(--sidebar-hover)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]"
              }
            `}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)]" />
            )}

            <Terminal size={12} className="shrink-0 opacity-60" />

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
                className="w-20 bg-transparent border border-[var(--app-shell-border)] rounded px-1 text-xs text-[var(--foreground)] outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate max-w-[120px]">{tab.title}</span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={`
                ml-1 rounded p-0.5 transition-colors duration-150
                text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-border)]
                ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
              `}
              aria-label={`Close ${tab.title}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onCreate}
        className="shrink-0 flex items-center justify-center p-1.5 mx-1 rounded
          text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]
          transition-colors duration-150"
        aria-label="New terminal tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

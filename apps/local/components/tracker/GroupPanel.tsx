"use client";

import React, { useCallback, useState } from "react";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { TrackerItem } from "@/lib/tracker/types";
import type { TaskGroup } from "@/hooks/useTaskGroups";
import { TicketRow } from "./TicketRow";

interface GroupPanelProps {
  group: TaskGroup;
  items: TrackerItem[];
  onUpdateName: (name: string) => void;
  onDelete: () => void;
  onSelectItem: (itemId: string) => void;
}

export function GroupPanel({
  group,
  items,
  onUpdateName,
  onDelete,
  onSelectItem,
}: GroupPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) {
      onUpdateName(trimmed);
    }
    setEditing(false);
  }, [editName, group.name, onUpdateName]);

  const groupItems = items.filter((item) =>
    group.task_ids.includes(item.id),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--card-border)] px-4 py-3">
        <FolderOpen size={16} className="shrink-0 text-[var(--muted-foreground)]" />
        {editing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveName();
              if (e.key === "Escape") {
                setEditName(group.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--foreground)] outline-none border-b border-[var(--primary)]"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
            {group.name}
          </h3>
        )}
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          onClick={() => {
            setEditName(group.name);
            setEditing(true);
          }}
          title="Rename group"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
          onClick={onDelete}
          title="Delete group (ungroups tickets)"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Tickets ({groupItems.length})
        </div>
        {groupItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            No tickets in this group.
          </div>
        ) : (
          groupItems.map((item) => (
            <TicketRow
              key={item.id}
              item={item}
              selected={false}
              onSelect={() => onSelectItem(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

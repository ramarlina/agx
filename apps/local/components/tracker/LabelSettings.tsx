"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { LabelDefinition } from "@/hooks/useTrackerLabels";

interface LabelSettingsProps {
  definitions: LabelDefinition[];
  onCreate: (name: string, color?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

export function LabelSettings({ definitions, onCreate, onDelete }: LabelSettingsProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    await onCreate(name.trim(), color);
    setName("");
    setCreating(false);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">Local Labels</h3>
      <p className="text-xs text-[var(--muted-foreground)]">
        Define labels for local task tracking. These are stored locally and not synced to your tracker.
      </p>

      {definitions.length > 0 && (
        <div className="space-y-1">
          {definitions.map((def) => (
            <div
              key={def.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--card-bg)]"
            >
              {def.color && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: def.color }}
                />
              )}
              <span className="min-w-0 flex-1 text-sm text-[var(--foreground)]">{def.name}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                onClick={() => void onDelete(def.id)}
                title="Delete label"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] p-2">
        <div className="flex gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`h-5 w-5 rounded-full transition-all ${
                color === c ? "ring-2 ring-[var(--foreground)] ring-offset-1 ring-offset-[var(--background)]" : ""
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <input
          type="text"
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="Label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleCreate();
            }
          }}
        />
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          onClick={() => void handleCreate()}
          disabled={!name.trim() || creating}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

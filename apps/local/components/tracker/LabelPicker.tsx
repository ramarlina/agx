"use client";

import React, { useState, useCallback, useMemo } from "react";
import { Check, Minus, Plus } from "lucide-react";

interface LabelEntry {
  name: string;
  color: string | null;
  defined: boolean;
}

interface LabelPickerProps {
  labels: LabelEntry[];
  selectedLabels: string[];
  labelCounts?: Map<string, number>;
  totalSelected?: number;
  onToggle: (label: string) => void;
  onAdd: (label: string) => void;
}

export function LabelPicker({
  labels,
  selectedLabels,
  labelCounts,
  totalSelected,
  onToggle,
  onAdd,
}: LabelPickerProps) {
  const [input, setInput] = useState("");
  const selectedSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);
  const isBulk = totalSelected != null && totalSelected > 0;

  const filteredLabels = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, input]);

  const handleAdd = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      onAdd(trimmed);
    }
    onToggle(trimmed);
    setInput("");
  }, [input, labels, onAdd, onToggle]);

  return (
    <div className="flex w-56 flex-col gap-1">
      <div className="max-h-48 overflow-y-auto">
        {filteredLabels.map((label) => {
          const isSelected = selectedSet.has(label.name);
          const count = labelCounts?.get(label.name) ?? 0;
          const isMixed = isBulk && count > 0 && count < (totalSelected ?? 0);

          return (
            <button
              key={label.name}
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                isSelected
                  ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => onToggle(label.name)}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  isSelected || isMixed
                    ? "border-blue-500 bg-blue-500 text-white"
                    : "border-[var(--card-border)]"
                }`}
              >
                {isMixed ? <Minus size={10} /> : isSelected ? <Check size={10} /> : null}
              </span>
              {label.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </button>
          );
        })}
        {filteredLabels.length === 0 && input.trim() && (
          <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
            No matching labels
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--card-border)] pt-1">
        <input
          type="text"
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="Add label..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)] disabled:opacity-40"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

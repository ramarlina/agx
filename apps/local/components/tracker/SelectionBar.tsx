"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  FolderPlus,
  Hash,
  MessageSquare,
  RefreshCw,
  Tag,
  X,
} from "lucide-react";
import { LabelPicker } from "./LabelPicker";
import { PromptPopover } from "./PromptPopover";
import type { FilterOption } from "./TrackerBoardFilters";
import type { Participant } from "@/lib/types";

interface LabelEntry {
  name: string;
  color: string | null;
  defined: boolean;
}

interface ItemMetadata {
  labels: string[];
  estimate: number | null;
}

interface SelectionBarProps {
  count: number;
  onGroup: () => void;
  onClear: () => void;
  onBulkRecap: () => void;
  onBulkPrompt: (prompt: string, agentId: string) => void;
  onBulkEstimate: () => void;
  onBulkAddLabel: (label: string) => void;
  onBulkRemoveLabel: (label: string) => void;
  onBulkStatus: (status: string) => void;
  statusOptions: FilterOption[];
  participants: Participant[];
  labels: LabelEntry[];
  onCreateLabel: (name: string) => void;
  selectedMetadata: Map<string, ItemMetadata>;
  statusUpdating?: boolean;
}

type ActivePopover = "label" | "status" | "prompt" | null;

function Popover({
  open,
  onClose,
  anchorRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2 shadow-lg backdrop-blur-sm"
    >
      {children}
    </div>
  );
}

export function SelectionBar({
  count,
  onGroup,
  onClear,
  onBulkRecap,
  onBulkPrompt,
  onBulkEstimate,
  onBulkAddLabel,
  onBulkRemoveLabel,
  onBulkStatus,
  statusOptions,
  participants,
  labels,
  onCreateLabel,
  selectedMetadata,
  statusUpdating,
}: SelectionBarProps) {
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);
  const labelRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const promptRef = useRef<HTMLButtonElement | null>(null);

  const togglePopover = useCallback((popover: ActivePopover) => {
    setActivePopover((current) => (current === popover ? null : popover));
  }, []);

  const labelCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const meta of selectedMetadata.values()) {
      for (const label of meta.labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return counts;
  }, [selectedMetadata]);

  const allSelectedLabels = React.useMemo(() => {
    const all = new Set<string>();
    for (const meta of selectedMetadata.values()) {
      for (const label of meta.labels) all.add(label);
    }
    return Array.from(all);
  }, [selectedMetadata]);

  if (count < 2) return null;

  const actionButtonClass =
    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]";

  return (
    <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 shadow-2xl">
        <span className="mr-1 text-xs font-medium text-[var(--foreground)]">
          {count} selected
        </span>

        <div className="mx-1 h-4 w-px bg-[var(--card-border)]" />

        {/* Recap */}
        <button type="button" className={actionButtonClass} onClick={onBulkRecap} title="Recap all selected">
          <FileText size={12} />
          Recap
        </button>

        {/* Prompt */}
        <div className="relative">
          <button
            ref={promptRef}
            type="button"
            className={`${actionButtonClass} ${activePopover === "prompt" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
            onClick={() => togglePopover("prompt")}
            title="Send prompt to all selected"
          >
            <MessageSquare size={12} />
            Prompt
          </button>
          <Popover open={activePopover === "prompt"} onClose={() => setActivePopover(null)} anchorRef={promptRef}>
            <PromptPopover
              count={count}
              participants={participants}
              onSend={(prompt, agentId) => {
                onBulkPrompt(prompt, agentId);
                setActivePopover(null);
              }}
            />
          </Popover>
        </div>

        {/* Estimate */}
        <button
          type="button"
          className={actionButtonClass}
          onClick={onBulkEstimate}
          title="Ask the LLM to size all selected"
        >
          <Hash size={12} />
          Estimate
        </button>

        {/* Label */}
        <div className="relative">
          <button
            ref={labelRef}
            type="button"
            className={`${actionButtonClass} ${activePopover === "label" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
            onClick={() => togglePopover("label")}
            title="Label all selected"
          >
            <Tag size={12} />
            Label
          </button>
          <Popover open={activePopover === "label"} onClose={() => setActivePopover(null)} anchorRef={labelRef}>
            <LabelPicker
              labels={labels}
              selectedLabels={allSelectedLabels}
              labelCounts={labelCounts}
              totalSelected={count}
              onToggle={(label) => {
                const c = labelCounts.get(label) ?? 0;
                if (c === count) {
                  onBulkRemoveLabel(label);
                } else {
                  onBulkAddLabel(label);
                }
              }}
              onAdd={onCreateLabel}
            />
          </Popover>
        </div>

        {/* Status */}
        <div className="relative">
          <button
            ref={statusRef}
            type="button"
            className={`${actionButtonClass} ${activePopover === "status" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
            onClick={() => togglePopover("status")}
            title="Update status for all selected"
            disabled={statusUpdating}
          >
            {statusUpdating ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Status
          </button>
          <Popover open={activePopover === "status"} onClose={() => setActivePopover(null)} anchorRef={statusRef}>
            <div className="flex max-h-48 w-44 flex-col overflow-y-auto">
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  onClick={() => {
                    onBulkStatus(opt.value);
                    setActivePopover(null);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Popover>
        </div>

        {/* Group */}
        <button type="button" className={actionButtonClass} onClick={onGroup} title="Group selected">
          <FolderPlus size={12} />
          Group
        </button>

        <div className="mx-1 h-4 w-px bg-[var(--card-border)]" />

        {/* Clear */}
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

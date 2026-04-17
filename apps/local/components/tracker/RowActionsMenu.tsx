"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Hash, MessageSquare, RefreshCw, Tag } from "lucide-react";
import { LabelPicker } from "./LabelPicker";
import { PromptPopover } from "./PromptPopover";
import type { FilterOption } from "./TrackerBoardFilters";
import type { Participant } from "@/lib/types";

interface LabelEntry {
  name: string;
  color: string | null;
  defined: boolean;
}

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  participants: Participant[];
  labels: LabelEntry[];
  selectedLabels: string[];
  statusOptions: FilterOption[];
  onRecap: () => void;
  onPrompt: (prompt: string, agentId: string) => void;
  onEstimate: () => void;
  onToggleLabel: (label: string) => void;
  onAddLabel: (name: string) => void;
  onStatus: (status: string) => void;
}

type SubPopover = "prompt" | "label" | "status" | null;

export function RowActionsMenu({
  anchorRef,
  onClose,
  participants,
  labels,
  selectedLabels,
  statusOptions,
  onRecap,
  onPrompt,
  onEstimate,
  onToggleLabel,
  onAddLabel,
  onStatus,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const subPanelRef = useRef<HTMLDivElement | null>(null);
  const promptItemRef = useRef<HTMLButtonElement | null>(null);
  const labelItemRef = useRef<HTMLButtonElement | null>(null);
  const statusItemRef = useRef<HTMLButtonElement | null>(null);
  const [sub, setSub] = useState<SubPopover>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [subTop, setSubTop] = useState<number | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const estWidth = 160;
    const left = Math.min(
      Math.max(8, rect.right - estWidth),
      window.innerWidth - estWidth - 8
    );
    const top = rect.bottom + 4;
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (subPanelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (sub) setSub(null);
        else onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, anchorRef, sub]);

  const toggleSub = useCallback((next: SubPopover) => {
    setSub((current) => (current === next ? null : next));
  }, []);

  useEffect(() => {
    if (!sub) {
      setSubTop(null);
      return;
    }
    const ref =
      sub === "prompt" ? promptItemRef : sub === "label" ? labelItemRef : statusItemRef;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setSubTop(rect.top);
  }, [sub]);

  const actionButtonClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]";

  if (!pos) return null;

  return (
    <>
      <div
        ref={panelRef}
        className="fixed z-[60] flex w-40 flex-col gap-0.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-2xl"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => {
            onRecap();
            onClose();
          }}
          title="Recap this ticket"
        >
          <FileText size={12} />
          Recap
        </button>
        <button
          ref={promptItemRef}
          type="button"
          className={`${actionButtonClass} ${sub === "prompt" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
          onClick={() => toggleSub("prompt")}
          title="Send prompt"
        >
          <MessageSquare size={12} />
          Prompt
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => {
            onEstimate();
            onClose();
          }}
          title="Ask the LLM to size this ticket"
        >
          <Hash size={12} />
          Estimate
        </button>
        <button
          ref={labelItemRef}
          type="button"
          className={`${actionButtonClass} ${sub === "label" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
          onClick={() => toggleSub("label")}
          title="Label"
        >
          <Tag size={12} />
          Label
        </button>
        <button
          ref={statusItemRef}
          type="button"
          className={`${actionButtonClass} ${sub === "status" ? "bg-[var(--background)] text-[var(--foreground)]" : ""}`}
          onClick={() => toggleSub("status")}
          title="Change status"
        >
          <RefreshCw size={12} />
          Status
        </button>
      </div>
      {sub && (
        <div
          ref={subPanelRef}
          className="fixed z-[60] rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2 shadow-lg backdrop-blur-sm"
          style={(() => {
            const menuWidth = 160;
            const subWidth = sub === "prompt" ? 340 : 200;
            const rightEdge = pos.left + menuWidth + 4;
            const fitsRight = rightEdge + subWidth <= window.innerWidth - 8;
            const left = fitsRight
              ? rightEdge
              : Math.max(8, pos.left - subWidth - 4);
            return { top: subTop ?? pos.top, left };
          })()}
          onClick={(e) => e.stopPropagation()}
        >
          {sub === "prompt" && (
            <PromptPopover
              count={1}
              participants={participants}
              onSend={(prompt, agentId) => {
                onPrompt(prompt, agentId);
                onClose();
              }}
            />
          )}
          {sub === "label" && (
            <LabelPicker
              labels={labels}
              selectedLabels={selectedLabels}
              onToggle={onToggleLabel}
              onAdd={onAddLabel}
            />
          )}
          {sub === "status" && (
            <div className="flex max-h-48 w-44 flex-col overflow-y-auto">
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  onClick={() => {
                    onStatus(opt.value);
                    onClose();
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

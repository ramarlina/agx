"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { TaskStatus } from "./TaskCard";

const statuses: { value: TaskStatus; label: string; color: string; icon: string }[] = [
  { value: "queued", label: "Queued", color: "var(--status-queued)", icon: "○" },
  { value: "in_progress", label: "In Progress", color: "var(--status-in-progress)", icon: "◑" },
  { value: "blocked", label: "Blocked", color: "var(--status-blocked)", icon: "⊘" },
  { value: "completed", label: "Done", color: "var(--status-completed)", icon: "●" },
  { value: "failed", label: "Failed", color: "var(--status-failed)", icon: "✕" },
];

interface StatusCircleProps {
  status: TaskStatus;
  onStatusChange?: (status: TaskStatus) => void;
}

export default function StatusCircle({ status, onStatusChange }: StatusCircleProps) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = (e: PointerEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open, updatePosition]);

  // Close dropdown when status changes externally (e.g., realtime update)
  useEffect(() => {
    setOpen(false);
  }, [status]);

  const current = statuses.find((s) => s.value === status) || statuses[0];
  const isCompleted = status === "completed";
  const isInProgress = status === "in_progress";

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (onStatusChange) setOpen(!open);
        }}
        className={`w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center transition-all
          hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--ring)]
          ${onStatusChange ? "cursor-pointer" : "cursor-default"}
          ${isInProgress ? "animate-pulse" : ""}
        `}
        style={{
          borderColor: current.color,
          backgroundColor: isCompleted ? current.color : "transparent",
        }}
        title={current.label}
      >
        {isCompleted && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {status === "failed" && (
          <svg className="w-2 h-2" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke={current.color} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        {isInProgress && (
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: current.color }}
          />
        )}
      </button>

      {open && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] py-1 rounded-lg border shadow-lg min-w-[140px]"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            backgroundColor: "var(--card-bg)",
            borderColor: "var(--card-border)",
          }}
        >
          {statuses.map((s) => {
            const isSelected = s.value === status;
            return (
            <button
              key={s.value}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
                hover:bg-[var(--item-hover-bg)]
                ${isSelected ? "font-semibold bg-[var(--item-hover-bg)]" : ""}
              `}
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange?.(s.value);
                setOpen(false);
              }}
            >
              <span
                className={`w-3 h-3 rounded-full border-[1.5px] flex items-center justify-center`}
                style={{
                  borderColor: s.color,
                  backgroundColor: s.value === "completed" ? s.color : "transparent",
                }}
              >
                {s.value === "completed" && (
                  <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {s.value === "failed" && (
                  <svg className="w-1.5 h-1.5" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3L9 9M9 3L3 9" stroke={s.color} strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
                {s.value === "in_progress" && (
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: s.color }} />
                )}
              </span>
              <span style={{ color: isSelected ? s.color : undefined }}>
                {s.label}
              </span>
              {isSelected && (
                <svg className="w-3 h-3 ml-auto" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

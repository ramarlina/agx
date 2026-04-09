"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import type { FileMentionSuggestion } from "@/hooks/useFileMention";
import { FileMentionPopoverItem } from "./FileMentionPopoverItem";
import styles from "./FileMentionPopover.module.css";

interface FileMentionPopoverProps {
  isOpen: boolean;
  suggestions: FileMentionSuggestion[];
  activeIndex: number;
  isLoading: boolean;
  /** Last fetch error message, if any */
  error: string | null;
  listboxId: string;
  optionIdPrefix: string;
  onSelect: (suggestion: FileMentionSuggestion) => void;
  onAttachContents: (suggestion: FileMentionSuggestion) => void;
}

export function FileMentionPopover({
  isOpen,
  suggestions,
  activeIndex,
  isLoading,
  error,
  listboxId,
  optionIdPrefix,
  onSelect,
  onAttachContents,
}: FileMentionPopoverProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [openBelow, setOpenBelow] = useState(false);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  // Viewport-aware positioning: flip to below if insufficient space above
  useEffect(() => {
    if (!isOpen || !wrapperRef.current) return;
    const el = wrapperRef.current;
    const rect = el.getBoundingClientRect();
    // Estimated popover height (max-h-64 = 256px + header row)
    const estimatedHeight = 280;
    const spaceAbove = rect.top;
    setOpenBelow(spaceAbove < estimatedHeight);
  }, [isOpen]);

  if (!isOpen) return null;

  const positionClass = openBelow
    ? "absolute left-0 right-0 top-full mt-2 z-20"
    : "absolute left-0 right-0 bottom-full mb-3 z-20";

  const activeOptionId =
    suggestions.length > 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;

  return (
    <div ref={wrapperRef} className={`${positionClass} ${styles.popover}`}>
      <div
        role="listbox"
        id={listboxId}
        aria-label="File suggestions"
        aria-activedescendant={activeOptionId}
        className="max-h-64 overflow-y-auto rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] shadow-lg"
      >
        {/* Error state */}
        {error && !isLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-red-500" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {/* Loading state — no stale results yet */}
        {!error && isLoading && suggestions.length === 0 && (
          <div
            className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--muted-foreground)]"
            aria-live="polite"
            aria-label="Searching for files"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>Searching…</span>
          </div>
        )}

        {/* Empty state (done loading, no results) */}
        {!error && !isLoading && suggestions.length === 0 && (
          <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]" aria-live="polite">
            No results
          </div>
        )}

        {/* Stale-results loading indicator */}
        {!error && isLoading && suggestions.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-[var(--muted-foreground)] border-b border-[var(--border)]">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span aria-live="polite" aria-label="Updating results">Updating…</span>
          </div>
        )}

        {/* Suggestion list */}
        {suggestions.length > 0 &&
          suggestions.map((suggestion, index) => (
            <FileMentionPopoverItem
              key={suggestion.path}
              suggestion={suggestion}
              isActive={index === activeIndex}
              optionId={`${optionIdPrefix}-${index}`}
              onSelect={onSelect}
              onAttachContents={onAttachContents}
              itemRef={(el) => {
                optionRefs.current[index] = el;
              }}
            />
          ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { MentionSuggestion } from "@/hooks/useMentionAutocomplete";
import { FolderKanban, Tag, Users } from "lucide-react";

interface MentionPopoverProps {
  isOpen: boolean;
  suggestions: MentionSuggestion[];
  activeIndex: number;
  listboxId: string;
  optionIdPrefix: string;
  onSelect: (suggestion: MentionSuggestion) => void;
}

export function MentionPopover({
  isOpen,
  suggestions,
  activeIndex,
  listboxId,
  optionIdPrefix,
  onSelect,
}: MentionPopoverProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    optionRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, isOpen]);

  if (!isOpen || suggestions.length === 0) {
    return null;
  }

  // Track which group headers we've rendered
  const renderedGroups = new Set<string>();

  return (
    <div className="absolute left-0 right-0 bottom-full mb-3 z-20">
      <div
        role="listbox"
        id={listboxId}
        aria-label="Mention suggestions"
        className="max-h-56 overflow-y-auto rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] shadow-lg"
      >
        {suggestions.map((suggestion, index) => {
          const isActive = index === activeIndex;
          const id =
            suggestion.kind === "project-group"
              ? `project-group-${suggestion.project.id}`
              : suggestion.kind === "project"
                ? `project-${suggestion.project.id}`
                : suggestion.kind === "ticket"
                  ? `ticket-${suggestion.issue.id}`
                  : suggestion.participant.id;
          const group = suggestion.group;

          // Show group header if this is a new non-empty group
          let groupHeader: React.ReactNode = null;
          if (group && !renderedGroups.has(group)) {
            renderedGroups.add(group);
            groupHeader = (
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] bg-[var(--app-shell-subtle)] border-t border-[var(--border)] first:border-t-0">
                {group}
              </div>
            );
          }

          if (suggestion.kind === "project-group") {
            return (
              <div key={id}>
                {groupHeader}
                <button
                  type="button"
                  role="option"
                  id={`${optionIdPrefix}-${id}`}
                  aria-selected={isActive}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-[var(--primary-muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => onSelect(suggestion)}
                >
                  <span className="inline-flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-hidden />
                    <span className="font-medium">{suggestion.project.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {suggestion.project.agents.length} agent{suggestion.project.agents.length !== 1 ? "s" : ""}
                    </span>
                  </span>
                </button>
              </div>
            );
          }

          if (suggestion.kind === "project") {
            return (
              <div key={id}>
                {groupHeader}
                <button
                  type="button"
                  role="option"
                  id={`${optionIdPrefix}-${id}`}
                  aria-selected={isActive}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-[var(--primary-muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => onSelect(suggestion)}
                >
                  <span className="inline-flex items-center gap-2">
                    <FolderKanban className="h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-hidden />
                    <span className="font-medium">{suggestion.project.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{suggestion.project.slug}</span>
                  </span>
                </button>
              </div>
            );
          }

          if (suggestion.kind === "ticket") {
            return (
              <div key={id}>
                {groupHeader}
                <button
                  type="button"
                  role="option"
                  id={`${optionIdPrefix}-${id}`}
                  aria-selected={isActive}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-[var(--primary-muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => onSelect(suggestion)}
                >
                  <span className="flex items-start gap-2">
                    <Tag className="mt-0.5 h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {suggestion.issue.identifier}
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                          {suggestion.issue.status}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        {suggestion.issue.title}
                      </span>
                    </span>
                  </span>
                </button>
              </div>
            );
          }

          const participant = suggestion.participant;
          return (
            <div key={id}>
              {groupHeader}
              <button
                type="button"
                role="option"
                id={`${optionIdPrefix}-${participant.id}`}
                aria-selected={isActive}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  isActive ? "bg-[var(--primary-muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                }${group ? " pl-6" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => onSelect(suggestion)}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: participant.color }}
                    aria-hidden
                  />
                  <span className="font-medium">{participant.name}</span>
                  {participant.id === "all" ? (
                    <span className="text-xs text-[var(--muted-foreground)]">All participants</span>
                  ) : participant.model && (
                    <span className="text-xs text-[var(--muted-foreground)]">{participant.model}</span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { SlashCommand } from "@/hooks/useCommandAutocomplete";

interface CommandPopoverProps {
  isOpen: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  listboxId: string;
  optionIdPrefix: string;
  onSelect: (command: SlashCommand) => void;
}

export function CommandPopover({
  isOpen,
  commands,
  activeIndex,
  listboxId,
  optionIdPrefix,
  onSelect,
}: CommandPopoverProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  if (!isOpen || commands.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 bottom-full mb-3 z-20">
      <div
        role="listbox"
        id={listboxId}
        aria-label="Command suggestions"
        className="max-h-56 overflow-y-auto rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] shadow-lg"
      >
        {commands.map((command, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={command.name}
              type="button"
              role="option"
              id={`${optionIdPrefix}-${command.name.slice(1)}`}
              aria-selected={isActive}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                isActive ? "bg-[var(--primary-muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(command)}
            >
              <span className="inline-flex items-center gap-2">
                <span className="font-medium font-mono">{command.name}</span>
                {command.aliases && command.aliases.length > 0 && (
                  <span className="text-xs text-[var(--app-shell-soft-text)] font-mono">({command.aliases.join(", ")})</span>
                )}
                <span className="text-xs text-[var(--muted-foreground)]">{command.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

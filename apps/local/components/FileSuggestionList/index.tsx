import React, { forwardRef } from "react";
import { FileSuggestion } from "@/types/fileMention";

export interface FileSuggestionListProps {
  suggestions: FileSuggestion[];
  activeIndex?: number;
  onSelect?: (suggestion: FileSuggestion) => void;
}

const FileIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const FileSuggestionList = forwardRef<HTMLUListElement, FileSuggestionListProps>(function FileSuggestionList({
  suggestions,
  activeIndex,
  onSelect,
}, ref) {
  if (suggestions.length === 0) return null;

  const activeId =
    activeIndex !== undefined ? `fsl-option-${activeIndex}` : undefined;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!onSelect) return;
    if (e.key === "Enter" && activeIndex !== undefined) {
      e.preventDefault();
      onSelect(suggestions[activeIndex]);
    }
  };

  return (
    <ul
      ref={ref}
      role="listbox"
      tabIndex={0}
      aria-activedescendant={activeId}
      onKeyDown={handleKeyDown}
      className="rounded-md border bg-popover shadow-md overflow-hidden text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {suggestions.map((suggestion, index) => {
        const isActive = index === activeIndex;
        const itemId = `fsl-option-${index}`;
        return (
          <li
            key={suggestion.path}
            id={itemId}
            role="option"
            aria-selected={isActive}
            title={suggestion.path}
            className={`flex items-center gap-2 px-3 cursor-pointer select-none min-h-[44px] ${
              isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            }`}
            onClick={() => onSelect?.(suggestion)}
          >
            <span className="shrink-0 text-muted-foreground" aria-hidden="true">
              {suggestion.type === "folder" ? <FolderIcon /> : <FileIcon />}
            </span>
            <span className="sr-only">
              {suggestion.type === "folder" ? "Folder" : "File"}:
            </span>
            <span className="truncate flex-1 font-mono" title={suggestion.path}>
              {suggestion.relativePath}
            </span>
            {suggestion.size !== undefined && (
              <span className="text-xs text-muted-foreground shrink-0">
                {formatBytes(suggestion.size)}
              </span>
            )}
            {suggestion.modifiedAt !== undefined && (
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(suggestion.modifiedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
});

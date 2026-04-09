"use client";

import { File, Folder, FolderOpen } from "lucide-react";
import type { FileMentionSuggestion } from "@/hooks/useFileMention";

// ─── Recency helpers ──────────────────────────────────────────────────────────

function formatRecency(modifiedAt: number | undefined): string | null {
  if (!modifiedAt) return null;
  const now = Date.now();
  const diffMs = now - modifiedAt;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FileMentionPopoverItemProps {
  suggestion: FileMentionSuggestion;
  isActive: boolean;
  optionId: string;
  onSelect: (suggestion: FileMentionSuggestion) => void;
  onAttachContents: (suggestion: FileMentionSuggestion) => void;
  itemRef: (el: HTMLButtonElement | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileMentionPopoverItem({
  suggestion,
  isActive,
  optionId,
  onSelect,
  onAttachContents,
  itemRef,
}: FileMentionPopoverItemProps) {
  const isFolder = suggestion.type === "folder";
  const isContentsMode = suggestion.attachMode === "contents";
  const recency = formatRecency(suggestion.modifiedAt);
  const displayPath = suggestion.relativePath ?? suggestion.path;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors duration-200 ${
        isActive ? "bg-[var(--primary-muted)]" : "hover:bg-[var(--app-shell-subtle)]"
      }`}
    >
      {/* File/folder icon */}
      <span className="shrink-0 text-[var(--muted-foreground)]" aria-hidden>
        {isFolder ? (
          isActive ? (
            <FolderOpen className="h-4 w-4 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 text-amber-400" />
          )
        ) : (
          <File className="h-4 w-4" />
        )}
      </span>

      {/* Main selection button */}
      <button
        type="button"
        role="option"
        id={optionId}
        aria-selected={isActive}
        ref={itemRef}
        className="min-w-0 flex-1 text-left"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(suggestion)}
        tabIndex={-1}
      >
        <span className="flex items-baseline gap-2">
          <span
            className={`block truncate font-mono text-xs ${
              isActive ? "text-[var(--foreground)]" : "text-[var(--foreground)]"
            }`}
          >
            {displayPath}
          </span>

          {/* Recency badge */}
          {recency && (
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{recency}</span>
          )}
        </span>

        {/* Folder manifest sub-line */}
        {isFolder && suggestion.manifest && (
          <span className="block text-xs text-[var(--muted-foreground)]">
            {suggestion.manifest.childCount} items ·{" "}
            {suggestion.manifest.sizeSummary}
            {isContentsMode ? (
              <span className="ml-1 font-medium text-[var(--primary)]">full tree</span>
            ) : (
              <span className="ml-1 text-[var(--muted-foreground)]">manifest</span>
            )}
          </span>
        )}
      </button>

      {/* Attach contents toggle (folders only) */}
      {isFolder && !isContentsMode && (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors duration-200"
          title="Attach full directory contents instead of manifest"
          aria-label={`Attach full contents of ${displayPath}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAttachContents(suggestion)}
          tabIndex={-1}
        >
          Attach contents
        </button>
      )}
      {isFolder && isContentsMode && (
        <span className="shrink-0 rounded bg-[var(--primary-muted)] px-1.5 py-0.5 text-xs font-medium text-[var(--primary)]">
          full tree
        </span>
      )}
    </div>
  );
}

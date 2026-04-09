import React from "react";
import { FileSuggestion } from "@/types/fileMention";

export interface FileMentionProps {
  suggestion: FileSuggestion;
  className?: string;
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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function FileMention({ suggestion, className }: FileMentionProps) {
  const { relativePath, type, size, modifiedAt } = suggestion;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-mono bg-muted text-muted-foreground ${className ?? ""}`}
      title={suggestion.path}
    >
      {type === "folder" ? <FolderIcon /> : <FileIcon />}
      <span className="sr-only">{type === "folder" ? "Folder:" : "File:"}</span>
      <span>{relativePath}</span>
      {size !== undefined && (
        <span className="text-xs opacity-60">{formatBytes(size)}</span>
      )}
      {modifiedAt !== undefined && (
        <span className="text-xs opacity-60">{formatDate(modifiedAt)}</span>
      )}
    </span>
  );
}

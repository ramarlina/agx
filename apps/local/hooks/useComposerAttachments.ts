"use client";

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A file-path attachment added via @/path mention */
export interface FilePathAttachment {
  kind: "file-path";
  id: string;
  /** Absolute or ~-relative path as selected by the user */
  path: string;
  /** Display label (relative path) */
  label: string;
  /** Whether the resolved content is a full folder tree vs single file */
  attachMode?: "manifest" | "contents";
}

export type ComposerFileAttachment = FilePathAttachment;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseComposerAttachmentsReturn {
  /** File-path attachments pending for the next send */
  filePaths: FilePathAttachment[];
  /** Add a file-path attachment (deduplicates by path) */
  addFilePath: (path: string, label: string, attachMode?: "manifest" | "contents") => void;
  /** Remove a file-path attachment by id */
  removeFilePath: (id: string) => void;
  /** Clear all file-path attachments (call after successful submit) */
  clearFilePaths: () => void;
  /** True when there are pending file paths to attach */
  hasFilePaths: boolean;
}

/**
 * Manages file-path attachments (added via @/ mention) separately from
 * binary file uploads. File contents are NOT fetched here; use
 * agentContextBuilder.resolveFileAttachments() at submit time.
 */
export function useComposerAttachments(): UseComposerAttachmentsReturn {
  const [filePaths, setFilePaths] = useState<FilePathAttachment[]>([]);

  const addFilePath = useCallback(
    (path: string, label: string, attachMode?: "manifest" | "contents") => {
      setFilePaths((prev) => {
        // Deduplicate — updating attachMode if the path already exists
        const exists = prev.find((a) => a.path === path);
        if (exists) {
          return prev.map((a) =>
            a.path === path ? { ...a, label, attachMode: attachMode ?? a.attachMode } : a
          );
        }
        return [
          ...prev,
          {
            kind: "file-path",
            id: crypto.randomUUID(),
            path,
            label,
            attachMode,
          },
        ];
      });
    },
    []
  );

  const removeFilePath = useCallback((id: string) => {
    setFilePaths((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearFilePaths = useCallback(() => {
    setFilePaths([]);
  }, []);

  return {
    filePaths,
    addFilePath,
    removeFilePath,
    clearFilePaths,
    hasFilePaths: filePaths.length > 0,
  };
}

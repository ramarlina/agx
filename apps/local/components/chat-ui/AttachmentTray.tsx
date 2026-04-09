"use client";

import type { StagedAttachment } from "@/hooks/useAttachments";
import { X, RefreshCw, FileText, Image } from "lucide-react";

interface Props {
  attachments: StagedAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function AttachmentTray({ attachments, onRemove, onRetry }: Props) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.map((att) => {
        const isImage = att.mimeType.startsWith("image/");
        const isFailed = att.status === "failed";
        const isUploading = att.status === "uploading";

        return (
          <div
            key={att.id}
            className={`relative group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
              isFailed
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-[var(--border)] bg-[var(--app-shell-subtle)] text-[var(--muted-foreground)]"
            }`}
          >
            {/* Thumbnail or icon */}
            {isImage && att.previewUrl ? (
              <img
                src={att.previewUrl}
                alt={att.filename}
                className="w-8 h-8 rounded object-cover shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-[var(--muted)] flex items-center justify-center shrink-0">
                {isImage ? (
                  <Image className="w-4 h-4 text-[var(--muted-foreground)]" />
                ) : (
                  <FileText className="w-4 h-4 text-[var(--muted-foreground)]" />
                )}
              </div>
            )}

            <div className="min-w-0 max-w-[120px]">
              <div className="truncate font-medium">{att.filename}</div>
              {isFailed && att.error ? (
                <div className="truncate text-[10px] text-red-500">{att.error}</div>
              ) : (
                <div className="text-[10px] text-[var(--muted-foreground)]">{formatSize(att.size)}</div>
              )}
            </div>

            {/* Progress bar */}
            {isUploading && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--muted)] rounded-b-lg overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${att.progress}%` }}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-0.5 shrink-0">
              {isFailed && (
                <button
                  type="button"
                  onClick={() => onRetry(att.id)}
                  className="p-0.5 rounded hover:bg-red-100 transition-colors"
                  title="Retry upload"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="p-0.5 rounded hover:bg-[var(--muted)] transition-colors"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

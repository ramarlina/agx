"use client";

import type { Attachment } from "@/lib/types";
import { FileText, Download } from "lucide-react";

interface Props {
  attachments: Attachment[];
  compact?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function MessageAttachments({ attachments, compact = false }: Props) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  const imgMaxW = compact ? "max-w-[120px]" : "max-w-[240px]";
  const imgMaxH = compact ? "max-h-[90px]" : "max-h-[180px]";

  return (
    <div className="mt-2 space-y-2">
      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((att) => (
            <a
              key={att.id}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg overflow-hidden border border-[var(--border)] hover:border-[var(--border)] transition-colors"
            >
              <img
                src={att.url}
                alt={att.filename}
                className={`${imgMaxW} ${imgMaxH} object-cover`}
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {/* File chips */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((att) => (
            <a
              key={att.id}
              href={att.url}
              download={att.filename}
              className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--app-shell-subtle)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:border-[var(--border)] transition-colors ${
                compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
              }`}
            >
              <FileText className={`text-[var(--muted-foreground)] shrink-0 ${compact ? "w-3 h-3" : "w-3.5 h-3.5"}`} />
              <span className={`truncate ${compact ? "max-w-[100px]" : "max-w-[150px]"}`}>{att.filename}</span>
              <span className="text-[var(--muted-foreground)] shrink-0">{formatSize(att.size)}</span>
              <Download className={`text-[var(--muted-foreground)] shrink-0 ${compact ? "w-2.5 h-2.5" : "w-3 h-3"}`} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

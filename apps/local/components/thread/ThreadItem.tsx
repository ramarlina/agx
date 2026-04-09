"use client";

import { Hash } from "lucide-react";
import type { Thread } from "@/lib/storage";

interface ThreadItemProps {
  thread: Thread;
  isActive: boolean;
  onSelect: () => void;
}

const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

const getPreview = (thread: Thread) => {
  const latest = thread.messages.at(-1)?.content?.trim();
  if (!latest) {
    return "No messages yet";
  }
  const normalized = latest.replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 80).trim()}…` : normalized;
};

export function ThreadItem({ thread, isActive, onSelect }: ThreadItemProps) {
  const title = thread.title?.trim() || "Untitled thread";
  const preview = getPreview(thread);
  return (
    <li className="workspace-sidebar__list-item">
      <button
        type="button"
        className={`thread-item ${isActive ? "thread-item--active" : ""}`}
        onClick={onSelect}
        aria-current={isActive ? "page" : undefined}
      >
        <div className="thread-item__header">
          <div className="thread-item__title-wrap">
            <Hash size={12} className="thread-item__hash" aria-hidden="true" />
            <span className="thread-item__title">{title}</span>
          </div>
          <span className="thread-item__timestamp">{formatTimestamp(thread.updatedAt)}</span>
        </div>
        <span className="thread-item__meta">{preview}</span>
      </button>
    </li>
  );
}

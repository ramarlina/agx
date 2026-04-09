"use client";

import type { Thread } from "@/lib/storage";
import { ThreadItem } from "./ThreadItem";

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}

export function ThreadList({ threads, activeThreadId, onSelectThread }: ThreadListProps) {
  if (threads.length === 0) {
    return null;
  }

  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <ul className="workspace-sidebar__list" role="list">
      {sortedThreads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          isActive={thread.id === activeThreadId}
          onSelect={() => onSelectThread(thread.id)}
        />
      ))}
    </ul>
  );
}

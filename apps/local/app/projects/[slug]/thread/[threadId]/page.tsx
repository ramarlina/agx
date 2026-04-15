"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ChatContainer } from "@/components/chat-ui/ChatContainer";

export default function ProjectThreadPage({
  params,
}: {
  params: Promise<{ slug: string; threadId: string }>;
}) {
  const { slug, threadId } = use(params);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Thread header with back link */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--app-shell-border)] bg-[var(--background)]">
        <Link
          href={`/projects/${slug}/threads`}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeft size={14} />
          Threads
        </Link>
        <span className="text-xs text-[var(--muted-foreground)]">/</span>
        <div className="flex items-center gap-1.5 min-w-0">
          <MessageSquare size={12} className="text-indigo-500 flex-shrink-0" />
          <span className="text-xs font-medium text-[var(--foreground)] truncate">
            {decodeURIComponent(threadId)}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ChatContainer projectSlug={slug} initialThreadId={threadId} showSidebar={false} />
      </div>
    </div>
  );
}

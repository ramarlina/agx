"use client";

import { use } from "react";
import { ChatContainer } from "@/components/chat-ui/ChatContainer";

export default function ProjectThreadPage({
  params,
}: {
  params: Promise<{ slug: string; threadId: string }>;
}) {
  const { slug, threadId } = use(params);

  return <ChatContainer projectSlug={slug} initialThreadId={threadId} showSidebar={false} />;
}

"use client";

import { use } from "react";
import { ChatContainer } from "@/components/chat-ui/ChatContainer";

export default function ProjectChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return <ChatContainer projectSlug={slug} showSidebar={false} />;
}

"use client";

import { use } from "react";
import { ChatContainer } from "@/components/chat-ui/ChatContainer";

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ChatContainer initialRootMessageId={id} />;
}

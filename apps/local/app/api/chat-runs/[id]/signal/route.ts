import { NextRequest, NextResponse } from "next/server";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { LOCAL_USER } from "@/lib/auth-mode";
import { updateChatRun } from "@/lib/history-store";
import type { ChatRunJobData } from "@/lib/orchestrator/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const signal = typeof body?.signal === "string" ? body.signal.trim() : "";

  if (signal !== "cancel") {
    return NextResponse.json({ error: "Unsupported signal" }, { status: 400 });
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : undefined;

  await updateChatRun({
    id,
    status: "cancelled",
    lastError: reason || "Cancelled",
    completedAt: Date.now(),
    result: { cancelled: true },
  });

  const queue = await getQueue();
  const jobId = await queue.send<ChatRunJobData>(QUEUE_NAMES.CHAT_RUN_PROCESS, {
    chatRunId: id,
    userId: LOCAL_USER.id,
    signal: "cancel",
    payload: {
      reason,
    },
  });

  return NextResponse.json({ ok: true, jobId });
}

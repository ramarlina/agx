import { NextRequest } from "next/server";
import {
  loadHistory,
  clearHistory,
  clearRootThread,
  deleteMessage,
  saveMessages,
  sweepStaleWorkingReactions,
} from "@/lib/history-store";
import { getAttachmentsForMessages } from "@/lib/attachment-store";
import type { GroupMessage } from "@/lib/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readThreadIdFromRequest(request: NextRequest): string {
  return request.nextUrl.searchParams.get("threadId")?.trim() ?? "";
}

export async function GET(request: NextRequest) {
  const threadId = readThreadIdFromRequest(request);
  if (!threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }

  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : undefined;

  await sweepStaleWorkingReactions(threadId);
  const messages = await loadHistory(threadId, since);

  // Populate attachments
  const messageIds = messages.map((m) => m.id);
  const attachmentMap = await getAttachmentsForMessages(messageIds);
  for (const msg of messages) {
    const atts = attachmentMap.get(msg.id);
    if (atts && atts.length > 0) {
      msg.attachments = atts;
    }
  }

  return Response.json(messages);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch((err) => { logger.error('[history] body parse failed', logger.formatError(err)); return null; });
  const body = rawBody && typeof rawBody === "object"
    ? (rawBody as { threadId?: unknown; messages?: unknown })
    : {};
  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? (body.messages as GroupMessage[]) : [];
  await saveMessages(threadId, messages);
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const threadId = readThreadIdFromRequest(request);
  if (!threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }
  const rootMessageId = request.nextUrl.searchParams.get("rootMessageId")?.trim() ?? "";
  const messageId = request.nextUrl.searchParams.get("messageId")?.trim() ?? "";
  if (messageId) {
    await deleteMessage(threadId, messageId);
    return Response.json({ ok: true });
  }
  if (rootMessageId) {
    await clearRootThread(threadId, rootMessageId);
    return Response.json({ ok: true });
  }
  await clearHistory(threadId);
  return Response.json({ ok: true });
}

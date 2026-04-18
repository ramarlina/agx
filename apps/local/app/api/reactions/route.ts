import { NextRequest } from "next/server";
import { ReactionStoreError, setReaction } from "@/lib/history-store";
import type { ReactionType } from "@/lib/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReactionRequestBody {
  threadId?: unknown;
  messageId?: unknown;
  participantId?: unknown;
  type?: unknown;
  reason?: unknown;
  blockerCode?: unknown;
  hostPid?: unknown;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch((err) => { logger.error('[reactions] body parse failed', logger.formatError(err)); return null; });
  const body: ReactionRequestBody =
    rawBody && typeof rawBody === "object" ? (rawBody as ReactionRequestBody) : {};

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const participantId = typeof body.participantId === "string" ? body.participantId : "";
  const typeValue = typeof body.type === "string" ? body.type : "";
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const blockerCode = typeof body.blockerCode === "string" ? body.blockerCode : undefined;
  const hostPid =
    typeof body.hostPid === "number" && Number.isInteger(body.hostPid) && body.hostPid > 0
      ? body.hostPid
      : undefined;

  if (!threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }

  try {
    const result = await setReaction({
      threadId,
      messageId,
      participantId,
      type: typeValue as ReactionType,
      reason,
      blockerCode,
      hostPid,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReactionStoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to set reaction";
    return Response.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { listChatRuns } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId");
  const statusParam = request.nextUrl.searchParams.get("status");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const runs = await listChatRuns({
    threadId,
    status:
      statusParam === "active" ||
      statusParam === "queued" ||
      statusParam === "running" ||
      statusParam === "awaiting_user" ||
      statusParam === "blocked" ||
      statusParam === "completed" ||
      statusParam === "failed" ||
      statusParam === "cancelled"
        ? statusParam
        : undefined,
    limit,
  });

  return NextResponse.json(
    runs.map((run) => ({
      chatRunId: run.id,
      threadId: run.threadId,
      rootMessageId: run.rootMessageId,
      status: run.status,
    }))
  );
}

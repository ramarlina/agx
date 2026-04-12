import { NextRequest, NextResponse } from "next/server";
import { getActiveAgentsByThreads } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const threadIds = req.nextUrl.searchParams.get("threadIds")?.split(",").filter(Boolean) ?? [];

  if (threadIds.length === 0) {
    return NextResponse.json({ activeAgents: {} });
  }

  try {
    const map = await getActiveAgentsByThreads(threadIds);
    const result: Record<string, string[]> = {};
    for (const [threadId, agentIds] of map) {
      result[threadId] = agentIds;
    }
    return NextResponse.json({ activeAgents: result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch active agents" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAll, getAllEnriched, getByThread, getByWorkspace, killByThread, killByWorkspace } from "@/lib/agent-process-registry";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const enrich = req.nextUrl.searchParams.get("enrich") === "1";

  if (threadId) {
    return NextResponse.json(getByThread(threadId));
  }
  if (workspaceId) {
    return NextResponse.json(getByWorkspace(workspaceId));
  }
  if (enrich) {
    return NextResponse.json(getAllEnriched());
  }
  return NextResponse.json(getAll());
}

export async function DELETE(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");

  if (threadId) {
    const killed = killByThread(threadId);
    return NextResponse.json({ killed });
  }
  if (workspaceId) {
    const killed = killByWorkspace(workspaceId);
    return NextResponse.json({ killed });
  }
  return NextResponse.json({ error: "threadId or workspaceId required" }, { status: 400 });
}

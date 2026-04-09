import { NextRequest } from "next/server";
import { loadLogs, clearLogs } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readWorkspaceIdFromRequest(request: NextRequest): string {
  return request.nextUrl.searchParams.get("workspaceId")?.trim() ?? "";
}

export async function GET(request: NextRequest) {
  const workspaceId = readWorkspaceIdFromRequest(request);
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const rows = await loadLogs(workspaceId);
  const logs = rows.map((r) => ({
    timestamp: r.timestamp,
    participantId: r.participant_id,
    stream: r.stream,
    line: r.line,
  }));
  return Response.json(logs);
}

export async function DELETE(request: NextRequest) {
  const workspaceId = readWorkspaceIdFromRequest(request);
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }
  await clearLogs(workspaceId);
  return Response.json({ ok: true });
}

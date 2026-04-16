import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";
import { commandExists } from "@/lib/shell-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) return badRequest("projectId required");

  const adapter = resolveAdapter(tracker);
  const status = await adapter.getStatus(projectId);

  return NextResponse.json({
    provider: tracker,
    connected: status.connected,
    user: status.user,
    clis: {
      claude: commandExists("claude"),
      codex: commandExists("codex"),
      gemini: commandExists("gemini"),
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) return badRequest("projectId required");

  const adapter = resolveAdapter(tracker);
  await adapter.disconnect(projectId);

  // Remove from connection manifest
  const { removeTrackerConnection } = await import("@/lib/tracker/connections");
  removeTrackerConnection(projectId, tracker);

  return NextResponse.json({ disconnected: true });
}
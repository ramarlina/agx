import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker";
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";
import { addTrackerConnection } from "@/lib/tracker/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    accessToken?: string;
  };

  const projectId = body.projectId?.trim();
  const accessToken = body.accessToken?.trim();

  if (!projectId) return badRequest("projectId required");
  if (!accessToken) return badRequest("accessToken required");

  const adapter = resolveAdapter(tracker);

  if (!adapter.handleApiKeyConnect) {
    return NextResponse.json(
      { error: `${adapter.displayName} does not support API key authentication` },
      { status: 400 }
    );
  }

  try {
    await adapter.handleApiKeyConnect(projectId, accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save token" },
      { status: 400 }
    );
  }

  addTrackerConnection(projectId, {
    type: tracker,
    connectedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}

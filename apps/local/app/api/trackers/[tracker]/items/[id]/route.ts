import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";
import { updateCachedTrackerItemStatus } from "@/lib/tracker/tracker-item-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string; id: string }> }
) {
  const { tracker, id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) return badRequest("projectId required");

  const adapter = resolveAdapter(tracker);
  try {
    const item = await adapter.getItem(projectId, id);
    return NextResponse.json({ item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string; id: string }> }
) {
  const { tracker, id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) return badRequest("projectId required");

  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    assigneeId?: string;
    priority?: string;
    labels?: string[];
  };

  const adapter = resolveAdapter(tracker);
  try {
    const updated = await adapter.updateItem(projectId, id, body);

    // Keep the cache in sync so the board list reflects the new state immediately
    if (body.status && updated.status && updated.updatedAt) {
      await updateCachedTrackerItemStatus({
        issueId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      });
    }

    return NextResponse.json({ item: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
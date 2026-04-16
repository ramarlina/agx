import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";

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
    const activity = await adapter.getActivity(projectId, id);
    return NextResponse.json({ activity });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";
import type { TrackerStatusCategory } from "@/lib/tracker/types";

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

  const filters = {
    statusCategories: req.nextUrl.searchParams.getAll("statusCategory") as TrackerStatusCategory[],
    assigneeIds: req.nextUrl.searchParams.getAll("assigneeId"),
    groupIds: req.nextUrl.searchParams.getAll("groupId"),
    search: req.nextUrl.searchParams.get("search") ?? undefined,
    cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
    limit: req.nextUrl.searchParams.get("limit")
      ? Number(req.nextUrl.searchParams.get("limit"))
      : undefined,
  };

  try {
    const result = await adapter.listItems(projectId, filters);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch items";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
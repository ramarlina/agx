import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";

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
  try {
    const [assignees, groups, statuses] = await Promise.allSettled([
      adapter.listAssignees(projectId),
      adapter.listGroups(projectId),
      adapter.listStatuses(projectId),
    ]);

    return NextResponse.json({
      assignees: assignees.status === "fulfilled" ? assignees.value : [],
      groups: groups.status === "fulfilled" ? groups.value : [],
      statuses: statuses.status === "fulfilled" ? statuses.value : [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch options";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
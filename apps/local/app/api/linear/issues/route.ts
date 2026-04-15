import { NextRequest, NextResponse } from "next/server";
import {
  ensureLinearIssueCache,
  listLinearIssueSummaries,
} from "@/lib/linear-issues";
import { getLinearClient } from "@/lib/linear-client";
import { getIssueActivityMap } from "@/lib/linear-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const statuses = Array.from(
    new Set(
      params
        .getAll("status")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const search = toOptionalString(params.get("search"));
  const teamId = toOptionalString(params.get("teamId"));
  const assigneeIds = Array.from(
    new Set(
      params
        .getAll("assigneeId")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const cursor = toOptionalString(params.get("cursor"));
  const cycleId = toOptionalString(params.get("cycleId"));
  const projectSlug = toOptionalString(params.get("projectSlug"));
  const assignedToMe = params.get("assignedToMe") === "true";
  const refresh = params.get("refresh") === "true";
  const limit = Number(params.get("limit") ?? "50");
  const sortBy = (params.get("sortBy") ?? "").trim() as "activity" | "identifier" | "status" | "created" | "";
  const sortDir = (params.get("sortDir") ?? "").trim() as "asc" | "desc" | "";
  const hasActivity = params.get("hasActivity") === "true";

  try {
    const pullResult = await ensureLinearIssueCache({
      projectId,
      refresh,
      projectSlug,
    });

    // Fetch activity map when needed for sorting or filtering
    let activityMap: Map<string, string> | undefined;
    if (sortBy === "activity" || hasActivity) {
      activityMap = await getIssueActivityMap();
    }

    const data = await listLinearIssueSummaries({
      statuses,
      search,
      assigneeIds,
      assignedToMe,
      teamId,
      cycleId,
      cursor,
      limit,
      sortBy: sortBy || undefined,
      sortDir: sortDir || undefined,
      hasActivity,
      activityMap,
    });

    if (!data.syncState.lastPulledAt && !pullResult && !getLinearClient(projectId)) {
      return NextResponse.json({ error: "Not connected" }, { status: 401 });
    }

    return NextResponse.json({
      issues: data.issues,
      pageInfo: data.pageInfo,
      syncState: data.syncState,
      refreshedAt: pullResult?.pulledAt ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch issues" },
      { status: 500 },
    );
  }
}

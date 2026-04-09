import { NextRequest, NextResponse } from "next/server";
import {
  ensureLinearIssueCache,
  listLinearIssueSummaries,
} from "@/lib/linear-issues";
import { getLinearClient } from "@/lib/linear-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
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

  try {
    const pullResult = await ensureLinearIssueCache({
      refresh,
      projectSlug,
    });
    const data = await listLinearIssueSummaries({
      statuses,
      search,
      assigneeIds,
      assignedToMe,
      teamId,
      cycleId,
      cursor,
      limit,
    });

    if (!data.syncState.lastPulledAt && !pullResult && !getLinearClient()) {
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

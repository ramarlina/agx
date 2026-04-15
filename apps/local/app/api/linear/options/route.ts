import { NextRequest, NextResponse } from "next/server";
import { getLinearClient } from "@/lib/linear-client";
import { ensureLinearIssueCache } from "@/lib/linear-issues";
import { listCachedLinearIssueStatuses } from "@/lib/linear-issue-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const client = getLinearClient(projectId);
  if (!client) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  try {
    const projectSlug = toOptionalString(req.nextUrl.searchParams.get("projectSlug"));
    await ensureLinearIssueCache({ projectId, projectSlug });

    const [assigneesResult, teamsResult, cyclesResult, statusesResult] = await Promise.allSettled([
      client.users(),
      client.teams(),
      client.cycles(),
      listCachedLinearIssueStatuses(),
    ]);

    const assignees = assigneesResult.status === "fulfilled" ? assigneesResult.value : [];
    const teams = teamsResult.status === "fulfilled" ? teamsResult.value : [];
    const cycles = cyclesResult.status === "fulfilled" ? cyclesResult.value : [];
    const statuses = statusesResult.status === "fulfilled" ? statusesResult.value : [];

    return NextResponse.json({ assignees, teams, cycles, statuses });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch Linear filter options" },
      { status: 500 },
    );
  }
}

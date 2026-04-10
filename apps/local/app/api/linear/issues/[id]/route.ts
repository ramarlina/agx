import { NextRequest, NextResponse } from "next/server";
import { getLinearClient } from "@/lib/linear-client";
import { updateCachedLinearIssueStatus } from "@/lib/linear-issue-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface UpdateIssueBody {
  status?: unknown;
}

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const client = getLinearClient();
  if (!client) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const issueId = id.trim();
    const body = (await request.json().catch(() => ({}))) as UpdateIssueBody;
    const status = toOptionalString(body.status);

    if (!issueId || !status) {
      return NextResponse.json({ error: "Issue id and status are required" }, { status: 400 });
    }

    const issue = await client.updateIssueStatus(issueId, status);
    await updateCachedLinearIssueStatus({
      issueId: issue.id,
      status: issue.status,
      updatedAt: issue.updatedAt,
    });

    return NextResponse.json({ issue });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update Linear issue",
      },
      { status: 500 }
    );
  }
}

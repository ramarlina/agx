import { NextRequest, NextResponse } from "next/server";
import { getLinearIssueContexts } from "@/lib/linear-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LinearIssueContextBody {
  issueIds?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as LinearIssueContextBody;
    const issueIds = Array.isArray(body.issueIds)
      ? body.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    const issues = await getLinearIssueContexts(issueIds);
    return NextResponse.json({ issues });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load issue context" },
      { status: 500 }
    );
  }
}

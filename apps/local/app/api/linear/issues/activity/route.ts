import { NextRequest, NextResponse } from "next/server";
import { getIssueActivityMap } from "@/lib/linear-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() || undefined;

  try {
    const activityMap = await getIssueActivityMap(projectId);
    const result: Record<string, string> = {};
    for (const [issueId, lastActivityAt] of activityMap) {
      result[issueId] = lastActivityAt;
    }
    return NextResponse.json({ activity: result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch activity" },
      { status: 500 }
    );
  }
}

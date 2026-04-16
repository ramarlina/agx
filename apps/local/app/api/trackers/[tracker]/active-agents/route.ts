import { NextRequest, NextResponse } from "next/server";
import { getIssueActiveAgents } from "@/lib/tracker/tracker-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId =
    req.nextUrl.searchParams.get("projectId")?.trim() || undefined;

  try {
    const agents = await getIssueActiveAgents(projectId);
    return NextResponse.json({ agents });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch active agents" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getIssueStats } from "@/lib/tracker/tracker-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId =
    req.nextUrl.searchParams.get("projectId")?.trim() || undefined;

  try {
    const stats = await getIssueStats(projectId);
    return NextResponse.json({ stats });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch issue stats" },
      { status: 500 },
    );
  }
}

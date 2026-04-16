import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { getTrackerRun, listTrackerRuns } from "@/lib/tracker/tracker-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string; id: string }> }
) {
  const { tracker, id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const runId = req.nextUrl.searchParams.get("runId")?.trim();

  try {
    let run;
    if (runId) {
      run = await getTrackerRun(runId);
    } else {
      // Find the most recent run for this issue
      const runs = await listTrackerRuns({
        issueId: id,
        projectId: projectId ?? null,
        trackerType: tracker,
        limit: 1,
      });
      run = runs[0] ?? null;
    }

    if (!run || !run.recapFilePath) {
      return NextResponse.json({ recap: null });
    }

    const { readFile } = await import("fs/promises");
    const recap = await readFile(run.recapFilePath, "utf-8");
    return NextResponse.json({ recap });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch recap";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
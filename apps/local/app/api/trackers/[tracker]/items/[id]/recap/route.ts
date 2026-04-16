import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker";
import { getTrackerRun, listTrackerRuns } from "@/lib/tracker/tracker-run-store";
import {
  readLatestRecap,
  getRecapJob,
  enqueueRecap,
} from "@/lib/tracker/recap";
import { getAdapter } from "@/lib/tracker/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tracker: string; id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { tracker, id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const runId = req.nextUrl.searchParams.get("runId")?.trim();

  try {
    // Check for recap stored on a specific run
    if (runId) {
      const run = await getTrackerRun(runId);
      if (run?.recapFilePath) {
        const { readFile } = await import("fs/promises");
        const content = await readFile(run.recapFilePath, "utf-8");
        return NextResponse.json({
          content,
          generatedAt: run.updatedAt,
          filePath: run.recapFilePath,
          status: "idle",
          error: null,
        });
      }
    }

    // Check the standalone recap file
    const latest = await readLatestRecap(tracker, id);
    const job = getRecapJob(tracker, id);

    // Fall back to the most recent run's recap if no standalone file
    if (!latest) {
      const runs = await listTrackerRuns({
        issueId: id,
        projectId: projectId ?? null,
        trackerType: tracker,
        limit: 1,
      });
      const run = runs[0];
      if (run?.recapFilePath) {
        const { readFile } = await import("fs/promises");
        try {
          const content = await readFile(run.recapFilePath, "utf-8");
          return NextResponse.json({
            content,
            generatedAt: run.updatedAt,
            filePath: run.recapFilePath,
            status: job?.status ?? "idle",
            error: job?.error ?? null,
          });
        } catch {
          /* file missing */
        }
      }
    }

    return NextResponse.json({
      content: latest?.content ?? null,
      generatedAt: latest?.generatedAt.toISOString() ?? null,
      filePath: latest?.filePath ?? null,
      status: job?.status ?? "idle",
      error: job?.error ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch recap";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { tracker, id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();

  try {
    const adapter = getAdapter(tracker);

    let itemCtx: Parameters<typeof enqueueRecap>[2];
    try {
      const item = await adapter.getItem(projectId ?? "", id);
      itemCtx = {
        identifier: item.identifier,
        title: item.title,
        status: item.status,
        assignee: item.assignee?.name,
        description: item.description,
      };
    } catch {
      // Not a regular item — likely a group (cycle/sprint). Build context
      // from the most recent tracker run so the recap still has a title.
      const runs = await listTrackerRuns({
        issueId: id,
        trackerType: tracker,
        projectId: projectId ?? null,
        limit: 1,
      });
      const run = runs[0];
      itemCtx = {
        identifier: run?.issueIdentifier ?? id,
        title: run?.issueTitle ?? "Group",
        status: run?.issueStatus ?? "unknown",
      };
    }

    const jobState = enqueueRecap(tracker, id, itemCtx);
    return NextResponse.json({
      status: jobState.status,
      startedAt: new Date(jobState.startedAt).toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to enqueue recap";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

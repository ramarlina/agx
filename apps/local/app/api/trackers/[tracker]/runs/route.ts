import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { badRequest } from "@/lib/tracker/route-helpers";
import { createTrackerRun, listTrackerRuns } from "@/lib/tracker/tracker-run-store";
import type { TrackerRunMode } from "@/lib/tracker/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toMode(value: unknown): TrackerRunMode {
  return value === "scripted" ? "scripted" : "chat";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  try {
    const issueId = req.nextUrl.searchParams.get("issueId")?.trim();
    const projectId = req.nextUrl.searchParams.get("projectId")?.trim() ?? null;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    if (!issueId) return badRequest("issueId is required");

    const runs = await listTrackerRuns({
      issueId,
      projectId,
      trackerType: tracker,
      limit,
    });
    return NextResponse.json({ count: runs.length, runs });
  } catch (error) {
    logger.error("Failed to list tracker runs", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to list tracker runs", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const issueId = toOptionalString(body.issueId);
    const issueIdentifier = toOptionalString(body.issueIdentifier);
    const issueTitle = toOptionalString(body.issueTitle);
    const issueStatus = toOptionalString(body.issueStatus);
    const agentId = toOptionalString(body.agentId);
    const agentName = toOptionalString(body.agentName);

    if (!issueId || !issueIdentifier || !issueTitle || !issueStatus || !agentId || !agentName) {
      return badRequest("issueId, issueIdentifier, issueTitle, issueStatus, agentId, and agentName are required");
    }

    const run = await createTrackerRun({
      projectId: toOptionalString(body.projectId),
      projectSlug: toOptionalString(body.projectSlug),
      trackerType: tracker,
      issueId,
      issueIdentifier,
      issueTitle,
      issueStatus,
      issueAssignee: toOptionalString(body.issueAssignee),
      agentId,
      agentName,
      mode: toMode(body.mode),
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create tracker run", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to create tracker run", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
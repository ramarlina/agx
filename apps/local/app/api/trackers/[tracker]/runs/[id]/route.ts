import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { getTrackerRun, updateTrackerRun } from "@/lib/tracker/tracker-run-store";
import type { TrackerRunStatus } from "@/lib/tracker/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tracker: string; id: string }> };

interface UpdateTrackerRunBody {
  rootMessageId?: unknown;
  chatRunId?: unknown;
  status?: unknown;
  error?: unknown;
}

function toOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toStatus(value: unknown): TrackerRunStatus | undefined {
  if (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const run = await getTrackerRun(id);
    if (!run) {
      return NextResponse.json({ error: "Tracker run not found" }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (error) {
    logger.error("Failed to load tracker run", logger.formatError(error));
    return NextResponse.json(
      {
        error: "Failed to load tracker run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as UpdateTrackerRunBody;
    const run = await updateTrackerRun({
      id,
      rootMessageId: toOptionalString(body.rootMessageId),
      chatRunId: toOptionalString(body.chatRunId),
      status: toStatus(body.status),
      error: toOptionalString(body.error),
    });

    if (!run) {
      return NextResponse.json({ error: "Tracker run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    logger.error("Failed to update tracker run", logger.formatError(error));
    return NextResponse.json(
      {
        error: "Failed to update tracker run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
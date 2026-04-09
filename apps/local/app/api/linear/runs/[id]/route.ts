import { NextRequest, NextResponse } from "next/server";
import { getLinearRun, updateLinearRun, type LinearRunStatus } from "@/lib/linear-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface UpdateLinearRunBody {
  rootMessageId?: unknown;
  chatRunId?: unknown;
  status?: unknown;
  error?: unknown;
}

function toOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toStatus(value: unknown): LinearRunStatus | undefined {
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

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const run = await getLinearRun(id);
    if (!run) {
      return NextResponse.json({ error: "Linear run not found" }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (error) {
    console.error("Failed to load Linear run:", error);
    return NextResponse.json(
      {
        error: "Failed to load Linear run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as UpdateLinearRunBody;
    const run = await updateLinearRun({
      id,
      rootMessageId: toOptionalString(body.rootMessageId),
      chatRunId: toOptionalString(body.chatRunId),
      status: toStatus(body.status),
      error: toOptionalString(body.error),
    });

    if (!run) {
      return NextResponse.json({ error: "Linear run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    console.error("Failed to update Linear run:", error);
    return NextResponse.json(
      {
        error: "Failed to update Linear run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

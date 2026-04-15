import { NextRequest, NextResponse } from "next/server";
import {
  createLinearRun,
  listLinearRuns,
  type LinearRunMode,
} from "@/lib/linear-run-store";
import { readLatestRecap } from "@/src/linear-recap/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateLinearRunBody {
  projectId?: unknown;
  projectSlug?: unknown;
  issueId?: unknown;
  issueIdentifier?: unknown;
  issueTitle?: unknown;
  issueStatus?: unknown;
  issueAssignee?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  mode?: unknown;
}

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toMode(value: unknown): LinearRunMode {
  return value === "scripted" ? "scripted" : "chat";
}

export async function GET(request: NextRequest) {
  try {
    const issueId = request.nextUrl.searchParams.get("issueId")?.trim();
    const projectId = request.nextUrl.searchParams.get("projectId")?.trim() ?? null;
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }

    const runs = await listLinearRuns({ issueId, projectId, limit });
    return NextResponse.json({ count: runs.length, runs });
  } catch (error) {
    console.error("Failed to list Linear runs:", error);
    return NextResponse.json(
      {
        error: "Failed to list Linear runs",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateLinearRunBody;
    const issueId = toOptionalString(body.issueId);
    const issueIdentifier = toOptionalString(body.issueIdentifier);
    const issueTitle = toOptionalString(body.issueTitle);
    const issueStatus = toOptionalString(body.issueStatus);
    const agentId = toOptionalString(body.agentId);
    const agentName = toOptionalString(body.agentName);

    if (!issueId || !issueIdentifier || !issueTitle || !issueStatus || !agentId || !agentName) {
      return NextResponse.json(
        {
          error:
            "issueId, issueIdentifier, issueTitle, issueStatus, agentId, and agentName are required",
        },
        { status: 400 }
      );
    }

    const latestRecap = await readLatestRecap(issueId);
    const recapFilePath = latestRecap?.filePath ?? null;

    const run = await createLinearRun({
      projectId: toOptionalString(body.projectId),
      projectSlug: toOptionalString(body.projectSlug),
      issueId,
      issueIdentifier,
      issueTitle,
      issueStatus,
      issueAssignee: toOptionalString(body.issueAssignee),
      agentId,
      agentName,
      mode: toMode(body.mode),
      recapFilePath,
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    console.error("Failed to create Linear run:", error);
    return NextResponse.json(
      {
        error: "Failed to create Linear run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

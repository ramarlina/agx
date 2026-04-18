import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/parse-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  try {
    const parsed = await parseBody<Record<string, unknown>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const issueId = toOptionalString(body.issueId);
    const issueIdentifier = toOptionalString(body.issueIdentifier);
    const issueTitle = toOptionalString(body.issueTitle);
    const issueStatus = toOptionalString(body.issueStatus);
    const agentId = toOptionalString(body.agentId);

    if (!issueId || !issueIdentifier || !issueTitle || !issueStatus || !agentId) {
      return NextResponse.json(
        {
          error:
            "issueId, issueIdentifier, issueTitle, issueStatus, and agentId are required",
        },
        { status: 400 }
      );
    }

    // Delegate to the scripted session starter, which is tracker-aware
    const { startScriptedTrackerSession } = await import("@/lib/tracker/scripted-session");
    const result = await startScriptedTrackerSession({
      trackerType: tracker,
      projectId: toOptionalString(body.projectId),
      projectSlug: toOptionalString(body.projectSlug),
      issue: {
        id: issueId,
        identifier: issueIdentifier,
        title: issueTitle,
        status: issueStatus,
        assignee: toOptionalString(body.issueAssignee),
      },
      agentId,
      scriptName: toOptionalString(body.scriptName),
      scriptPrompt: toOptionalString(body.scriptPrompt),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logger.error("Failed to start scripted tracker session", logger.formatError(error));
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start scripted tracker session",
      },
      { status: 500 }
    );
  }
}
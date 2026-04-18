import { NextRequest, NextResponse } from "next/server";
import {
  listAllGithubIssues,
  listGithubIssuesByRepo,
} from "@/lib/github-issue-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/github/issues?repoId=owner/name
 * Returns cached GitHub issues for a repo, or all if repoId is omitted.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const repoId = url.searchParams.get("repoId")?.trim() || null;
    const issues = repoId
      ? listGithubIssuesByRepo(repoId)
      : listAllGithubIssues();
    return NextResponse.json({ issues });
  } catch (error) {
    logger.error("Error listing github issues", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to list issues" },
      { status: 500 },
    );
  }
}

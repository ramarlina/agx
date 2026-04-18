import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { GithubClient } from "@/lib/github-client";
import { loadGithubTokens } from "@/lib/github-token-store";
import { syncRepo } from "@/lib/github-prs";
import { defaultResolvers } from "@/lib/github-resolvers";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/github/repos/sync
 * Body: { projectId: string, repoId: string }
 *
 * Fetches the latest PRs and issues for the given repo using the project's
 * stored GitHub tokens, upserts them into the local cache, and runs
 * PR→tracker-task matching via the default resolvers.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const repoId = typeof body.repoId === "string" ? body.repoId.trim() : "";
    if (!projectId || !repoId) {
      return NextResponse.json(
        { error: "projectId and repoId are required" },
        { status: 400 },
      );
    }

    const tokens = loadGithubTokens(projectId);
    if (!tokens) {
      return NextResponse.json(
        { error: "GitHub is not connected for this project" },
        { status: 401 },
      );
    }

    const client = new GithubClient({ tokens });
    await syncRepo({
      repoId,
      client,
      resolvers: defaultResolvers,
      force: true,
      includeIssues: true,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error syncing github repo", logger.formatError(error));
    return NextResponse.json({ error: "Failed to sync repo" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { loadGithubTokens } from "@/lib/github-token-store";
import { ensurePrContext } from "@/lib/github-pr-context";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const prId = typeof body.prId === "string" ? body.prId.trim() : "";
    const refresh = body.refresh === true;
    if (!projectId || !prId) {
      return NextResponse.json(
        { error: "projectId and prId are required" },
        { status: 400 },
      );
    }

    if (!loadGithubTokens(projectId)) {
      return NextResponse.json(
        { error: "GitHub is not connected for this project" },
        { status: 401 },
      );
    }

    const result = await ensurePrContext(projectId, prId, { refresh });
    if (!result) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      context: result.context,
      counts: result.counts,
    });
  } catch (error) {
    logger.error("Error building PR context", logger.formatError(error));
    return NextResponse.json({ error: "Failed to build PR context" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  listGithubRepos,
  upsertGithubRepo,
  removeGithubRepo,
} from "@/lib/github-repo-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/github/repos — list all attached repos. */
export async function GET() {
  try {
    const repos = listGithubRepos();
    return NextResponse.json({ repos });
  } catch (error) {
    logger.error("Error listing github repos", logger.formatError(error));
    return NextResponse.json({ error: "Failed to list repos" }, { status: 500 });
  }
}

/** POST /api/github/repos — attach or update a repo. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const owner = typeof body.owner === "string" ? body.owner.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const defaultBranch =
      typeof body.defaultBranch === "string" && body.defaultBranch.trim().length > 0
        ? body.defaultBranch.trim()
        : null;
    const isPrivate = body.private === true;

    if (!owner || !name) {
      return NextResponse.json(
        { error: "owner and name are required" },
        { status: 400 },
      );
    }

    const repo = upsertGithubRepo({ owner, name, defaultBranch, private: isPrivate });
    return NextResponse.json({ repo }, { status: 201 });
  } catch (error) {
    logger.error("Error upserting github repo", logger.formatError(error));
    return NextResponse.json({ error: "Failed to save repo" }, { status: 500 });
  }
}

/** DELETE /api/github/repos — detach a repo by id. */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    removeGithubRepo(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error removing github repo", logger.formatError(error));
    return NextResponse.json({ error: "Failed to remove repo" }, { status: 500 });
  }
}

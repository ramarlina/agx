// apps/local/app/api/git/workspaces/refresh/route.ts
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { loadRepoIndex } from "@/lib/git-repo-index";
import { listMatchingWorkspaces } from "@/lib/git-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { repoPath?: unknown; ticketId?: unknown };
  try {
    body = (await req.json()) as { repoPath?: unknown; ticketId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const repoPath = typeof body.repoPath === "string" ? body.repoPath : "";
  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
  if (!repoPath || !ticketId) {
    return NextResponse.json(
      { error: "repoPath and ticketId required" },
      { status: 400 },
    );
  }

  if (!path.isAbsolute(repoPath) || repoPath.split(path.sep).includes("..")) {
    return NextResponse.json({ error: "invalid repoPath" }, { status: 403 });
  }

  try {
    const idx = await loadRepoIndex();
    if (!idx || !idx.entries.some((e) => e.path === repoPath)) {
      return NextResponse.json(
        { error: "repoPath not in index" },
        { status: 403 },
      );
    }

    const workspaces = await listMatchingWorkspaces({
      repoPaths: [repoPath],
      ticketId,
    });
    return NextResponse.json({ workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `refresh failed: ${message}` },
      { status: 502 },
    );
  }
}

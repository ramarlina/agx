// apps/local/app/api/git/workspaces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadRepoIndex } from "@/lib/git-repo-index";
import { listMatchingWorkspaces } from "@/lib/git-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ticketId = req.nextUrl.searchParams.get("ticketId")?.trim() ?? "";
  if (!ticketId) {
    return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  }

  try {
    const idx = await loadRepoIndex();
    if (!idx || Date.now() - idx.scannedAt > STALE_MS) {
      return NextResponse.json({
        workspaces: [],
        stale: true,
        scannedAt: idx?.scannedAt ?? null,
      });
    }

    const workspaces = await listMatchingWorkspaces({
      repoPaths: idx.entries.map((e) => e.path),
      ticketId,
    });
    return NextResponse.json({
      workspaces,
      stale: false,
      scannedAt: idx.scannedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `git workspaces failed: ${message}` },
      { status: 502 },
    );
  }
}

// apps/local/app/api/git/workspaces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ensureFreshRepoIndex, RESCAN_TTL_MS } from "@/lib/git-repo-index";
import { listMatchingWorkspaces } from "@/lib/git-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticketId = req.nextUrl.searchParams.get("ticketId")?.trim() ?? "";
  if (!ticketId) {
    return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  }

  try {
    const { index, scanning } = await ensureFreshRepoIndex();
    const stale =
      index === null || Date.now() - index.scannedAt > RESCAN_TTL_MS;

    if (!index || stale) {
      return NextResponse.json({
        workspaces: [],
        stale: true,
        scannedAt: index?.scannedAt ?? null,
        scanning,
      });
    }

    const workspaces = await listMatchingWorkspaces({
      repoPaths: index.entries.map((e) => e.path),
      ticketId,
    });
    return NextResponse.json({
      workspaces,
      stale: false,
      scannedAt: index.scannedAt,
      scanning,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `git workspaces failed: ${message}` },
      { status: 502 },
    );
  }
}

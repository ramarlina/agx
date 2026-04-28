// apps/local/app/api/git/workspaces/rescan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { saveRepoIndex, scanForRepos } from "@/lib/git-repo-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  try {
    const idx = await scanForRepos();
    await saveRepoIndex(idx);
    return NextResponse.json({
      count: idx.entries.length,
      scannedAt: idx.scannedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `rescan failed: ${message}` },
      { status: 502 },
    );
  }
}

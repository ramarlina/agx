// apps/local/app/api/git/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ensureFreshRepoIndex } from "@/lib/git-repo-index";
import { suggestRepos } from "@/lib/repo-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug")?.trim() || null;
  const projectName = req.nextUrl.searchParams.get("projectName")?.trim() || null;

  const rawLimit = req.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  try {
    const { index, scanning } = await ensureFreshRepoIndex();
    const paths = index?.entries.map((e) => e.path) ?? [];

    const repos = suggestRepos(paths, {
      projectSlug,
      projectName,
      limit,
    });

    return NextResponse.json({
      repos,
      scanning,
      scannedAt: index?.scannedAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `repo suggestions failed: ${message}` },
      { status: 502 },
    );
  }
}

// apps/local/app/api/git/diff/route.ts
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { diffBranch, diffWorkingTree } from "@/lib/git-diff-cli";
import { loadRepoIndex } from "@/lib/git-repo-index";
import { getDefaultBranch } from "@/lib/git-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repoPath = req.nextUrl.searchParams.get("repoPath") ?? "";
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  const baseParam = req.nextUrl.searchParams.get("base");

  if (!repoPath || !ref) {
    return NextResponse.json(
      { error: "repoPath and ref required" },
      { status: 400 },
    );
  }

  if (!path.isAbsolute(repoPath) || repoPath.split(path.sep).includes("..")) {
    return NextResponse.json({ error: "invalid repoPath" }, { status: 403 });
  }

  const idx = await loadRepoIndex();
  if (!idx || !idx.entries.some((e) => e.path === repoPath)) {
    return NextResponse.json(
      { error: "repoPath not in index" },
      { status: 403 },
    );
  }

  try {
    let base = baseParam ?? "";
    if (!base) {
      base = (await getDefaultBranch(repoPath)) ?? "main";
    }

    const result =
      ref === "WORKING_TREE"
        ? await diffWorkingTree({ repoPath, base })
        : await diffBranch({ repoPath, base, ref });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `git diff failed: ${message}` },
      { status: 502 },
    );
  }
}

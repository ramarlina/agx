// apps/local/app/api/github/prs/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getGithubPr, listPrComments } from "@/lib/github-pr-store";
import { listPrFiles } from "@/lib/github-pr-files-store";
import { ensurePrContext } from "@/lib/github-pr-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const projectId = req.nextUrl.searchParams.get("projectId");
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (projectId) {
    const result = await ensurePrContext(projectId, id, { refresh });
    if (!result) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }
    return NextResponse.json({
      pr: result.pr,
      files: listPrFiles(id),
      comments: listPrComments(id),
    });
  }

  const pr = getGithubPr(id);
  if (!pr) {
    return NextResponse.json({ error: "PR not found" }, { status: 404 });
  }
  return NextResponse.json({
    pr,
    files: listPrFiles(id),
    comments: listPrComments(id),
  });
}

// apps/local/app/api/github/prs/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getGithubPr, listPrComments } from "@/lib/github-pr-store";
import { listPrFiles } from "@/lib/github-pr-files-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const pr = getGithubPr(id);
  if (!pr) {
    return NextResponse.json({ error: "PR not found" }, { status: 404 });
  }
  const files = listPrFiles(id);
  const comments = listPrComments(id);
  return NextResponse.json({ pr, files, comments });
}

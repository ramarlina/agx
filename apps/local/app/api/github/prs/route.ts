import { NextRequest, NextResponse } from "next/server";
import { listGithubPrs } from "@/lib/github-pr-store";
import { listGithubRepos } from "@/lib/github-repo-store";
import type { GithubPr } from "@/lib/github-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuickFilter = "all" | "mine" | "awaiting_review";

function parseQuickFilter(value: string | null): QuickFilter {
  if (value === "mine" || value === "awaiting_review") return value;
  return "all";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  const quickFilter = parseQuickFilter(searchParams.get("quickFilter"));
  const authorLogin = searchParams.get("authorLogin") || undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Number(limitParam) || 100) : 100;

  let prs: GithubPr[] = listGithubPrs({ repoId, limit });

  if (quickFilter === "mine" && authorLogin) {
    prs = prs.filter(
      (pr) =>
        pr.authorLogin === authorLogin || pr.assignees.includes(authorLogin),
    );
  } else if (quickFilter === "awaiting_review" && authorLogin) {
    prs = prs.filter((pr) =>
      pr.reviewers.some(
        (r) => r.login === authorLogin && r.state === "pending",
      ),
    );
  }

  const repos = listGithubRepos();

  return NextResponse.json({ prs, repos });
}

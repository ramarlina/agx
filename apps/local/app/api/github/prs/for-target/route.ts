import { NextRequest, NextResponse } from "next/server";
import { getGithubPr, listPrLinksForTarget } from "@/lib/github-pr-store";
import type { GithubPr, TrackerTargetType } from "@/lib/github-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TARGET_TYPES: TrackerTargetType[] = [
  "agx_task",
  "linear_issue",
  "jira_issue",
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");

  if (!targetType || !targetId) {
    return NextResponse.json(
      { error: "missing_params", message: "targetType and targetId are required" },
      { status: 400 },
    );
  }

  if (!VALID_TARGET_TYPES.includes(targetType as TrackerTargetType)) {
    return NextResponse.json(
      { error: "invalid_target_type", message: "invalid targetType" },
      { status: 400 },
    );
  }

  const links = listPrLinksForTarget(targetType as TrackerTargetType, targetId);
  const prs: GithubPr[] = [];
  for (const link of links) {
    const pr = getGithubPr(link.prId);
    if (pr) prs.push(pr);
  }

  return NextResponse.json({ prs });
}

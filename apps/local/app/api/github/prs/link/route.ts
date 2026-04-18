import { NextRequest, NextResponse } from "next/server";
import {
  deletePrLink,
  getGithubPr,
  upsertPrLink,
} from "@/lib/github-pr-store";
import type { TrackerTargetType } from "@/lib/github-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TARGET_TYPES: TrackerTargetType[] = [
  "agx_task",
  "linear_issue",
  "jira_issue",
];

function parsePrUrl(url: string): { prId: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") {
      return null;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    // expected: [owner, name, "pull"|"pulls", number, ...]
    if (parts.length < 4) return null;
    const [owner, name, kind, numberStr] = parts;
    if (kind !== "pull" && kind !== "pulls") return null;
    const number = Number(numberStr);
    if (!Number.isFinite(number) || number <= 0) return null;
    return { prId: `${owner}/${name}#${number}` };
  } catch {
    return null;
  }
}

function validateTargetType(t: unknown): t is TrackerTargetType {
  return (
    typeof t === "string" &&
    VALID_TARGET_TYPES.includes(t as TrackerTargetType)
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { url?: unknown; targetType?: unknown; targetId?: unknown }
    | null;

  if (!body) {
    return NextResponse.json(
      { error: "invalid_body", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { url, targetType, targetId } = body;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { error: "missing_url", message: "url is required" },
      { status: 400 },
    );
  }
  if (!validateTargetType(targetType)) {
    return NextResponse.json(
      { error: "invalid_target_type", message: "invalid targetType" },
      { status: 400 },
    );
  }
  if (typeof targetId !== "string" || !targetId.trim()) {
    return NextResponse.json(
      { error: "missing_target_id", message: "targetId is required" },
      { status: 400 },
    );
  }

  const parsed = parsePrUrl(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error: "invalid_url",
        message:
          "Could not parse PR URL. Expected https://github.com/{owner}/{repo}/pull/{n}",
      },
      { status: 400 },
    );
  }

  const pr = getGithubPr(parsed.prId);
  if (!pr) {
    return NextResponse.json(
      {
        error: "pr_not_cached",
        message:
          "This PR has not been synced yet. Add the repo in GitHub settings and run a sync first.",
      },
      { status: 404 },
    );
  }

  upsertPrLink({
    prId: parsed.prId,
    targetType,
    targetId,
    linkSource: "manual",
  });

  return NextResponse.json({ ok: true, prId: parsed.prId });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { prId?: unknown; targetType?: unknown; targetId?: unknown }
    | null;

  if (!body) {
    return NextResponse.json(
      { error: "invalid_body", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { prId, targetType, targetId } = body;
  if (typeof prId !== "string" || !prId.trim()) {
    return NextResponse.json(
      { error: "missing_pr_id", message: "prId is required" },
      { status: 400 },
    );
  }
  if (!validateTargetType(targetType)) {
    return NextResponse.json(
      { error: "invalid_target_type", message: "invalid targetType" },
      { status: 400 },
    );
  }
  if (typeof targetId !== "string" || !targetId.trim()) {
    return NextResponse.json(
      { error: "missing_target_id", message: "targetId is required" },
      { status: 400 },
    );
  }

  deletePrLink(prId, targetType, targetId);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { clearGithubTokens } from "@/lib/github-token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/github/oauth/disconnect — clears stored tokens for a project. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  clearGithubTokens(projectId);
  return NextResponse.json({ ok: true });
}

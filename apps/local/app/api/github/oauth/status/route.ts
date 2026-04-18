import { NextRequest, NextResponse } from "next/server";
import { loadGithubTokens } from "@/lib/github-token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/github/oauth/status?projectId=... — returns non-sensitive connection state. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const tokens = loadGithubTokens(projectId);
  if (!tokens) {
    return NextResponse.json({
      connected: false,
      login: null,
      scopes: [],
      expiresAt: null,
    });
  }

  return NextResponse.json({
    connected: true,
    login: tokens.login,
    scopes: tokens.scopes,
    expiresAt: tokens.expiresAt,
  });
}

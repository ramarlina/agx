import { NextRequest, NextResponse } from "next/server";
import { createOAuthSession } from "@/lib/github-oauth-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONNECT_BASE_URL = "https://www.runagx.com/connect/github";

/** GET /api/github/oauth/start?projectId=... — returns the URL the browser should open. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const session = createOAuthSession(projectId);
  const port = request.nextUrl.port || process.env.PORT || "3000";
  const returnUrl = `http://localhost:${port}/api/github/oauth/return`;

  const url = new URL(CONNECT_BASE_URL);
  url.searchParams.set("session", session);
  url.searchParams.set("return", returnUrl);
  url.searchParams.set("project", projectId);

  return NextResponse.json({ url: url.toString() });
}

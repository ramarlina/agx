import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-linear-auth-project";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Redirect to agx-web which owns the Linear OAuth credentials
  const url = new URL(req.url);
  const localPort = url.port || "3000";

  const response = NextResponse.redirect(
    `https://www.runagx.com/integrations/linear/auth?port=${localPort}`,
  );

  // Stash the projectId in a short-lived cookie so the callback knows
  // which project's token file to write.
  response.cookies.set(AUTH_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}

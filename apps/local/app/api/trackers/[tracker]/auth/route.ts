import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker";
import { resolveAdapter, badRequest } from "@/lib/tracker/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-tracker-auth-project";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) return badRequest("projectId required");

  const adapter = resolveAdapter(tracker);
  const authUrl = adapter.getAuthUrl(projectId);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(AUTH_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}

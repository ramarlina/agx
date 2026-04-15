import { NextRequest, NextResponse } from "next/server";
import { getConfiguredAppBaseUrl } from "@/lib/app-config";
import { saveProjectTicketToken } from "@/lib/linear-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-linear-auth-project";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const projectId = req.cookies.get(AUTH_PROJECT_COOKIE)?.value?.trim();

  if (!code || !projectId) {
    return NextResponse.redirect("/?linear=error");
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  const redirectUri = `${getConfiguredAppBaseUrl()}/api/linear/callback`;

  const tokenRes = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect("/?linear=error");
  }

  const data = await tokenRes.json();
  saveProjectTicketToken(projectId, "linear", {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  });

  const response = NextResponse.redirect("/?linear=connected");
  response.cookies.delete(AUTH_PROJECT_COOKIE);
  return response;
}

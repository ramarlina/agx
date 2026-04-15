import { NextRequest, NextResponse } from "next/server";
import { saveProjectTicketToken, LinearClient } from "@/lib/linear-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-linear-auth-project";

// OAuth callback — saves token and shows a "you can close this tab" page
export async function GET(req: NextRequest) {
  const accessToken = req.nextUrl.searchParams.get("access_token");
  const projectId =
    req.nextUrl.searchParams.get("projectId")?.trim() ||
    req.cookies.get(AUTH_PROJECT_COOKIE)?.value?.trim();

  if (!accessToken || !projectId) {
    return new NextResponse(
      "<html><body><p>Connection failed. You can close this tab.</p></body></html>",
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const expiresIn = req.nextUrl.searchParams.get("expires_in");

  saveProjectTicketToken(projectId, "linear", {
    accessToken,
    expiresAt: expiresIn ? Date.now() + Number(expiresIn) * 1000 : undefined,
  });

  const response = new NextResponse(
    `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666">
      <div style="text-align:center">
        <p>Connected to Linear. You can close this tab.</p>
        <script>window.close()</script>
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
  response.cookies.delete(AUTH_PROJECT_COOKIE);
  return response;
}

// Personal API key — saves token after validating it works
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accessToken = body.accessToken;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    // Validate the token by fetching the viewer
    const client = new LinearClient(accessToken);
    try {
      await client.viewer;
    } catch {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    saveProjectTicketToken(projectId, "linear", { accessToken });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

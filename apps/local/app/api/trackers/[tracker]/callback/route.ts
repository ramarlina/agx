import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { resolveAdapter } from "@/lib/tracker/route-helpers";
import { saveProjectTicketToken } from "@/lib/tracker/adapters/linear/client";
import { addTrackerConnection } from "@/lib/tracker/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-tracker-auth-project";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const projectId = req.cookies.get(AUTH_PROJECT_COOKIE)?.value?.trim();

  if (!code || !projectId) {
    return NextResponse.redirect("/?tracker=error");
  }

  const adapter = resolveAdapter(tracker);

  try {
    const tokenResult = await adapter.handleCallback(projectId, code);
    saveProjectTicketToken(projectId, tracker, {
      accessToken: tokenResult.accessToken,
      expiresAt: tokenResult.expiresAt,
    });

    // Record the connection in the manifest
    addTrackerConnection(projectId, {
      type: tracker,
      connectedAt: new Date().toISOString(),
    });

    const response = NextResponse.redirect(`/?${tracker}=connected`);
    response.cookies.delete(AUTH_PROJECT_COOKIE);
    return response;
  } catch {
    return NextResponse.redirect(`/?${tracker}=error`);
  }
}
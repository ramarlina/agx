import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker";
import { resolveAdapter } from "@/lib/tracker/route-helpers";
import { addTrackerConnection } from "@/lib/tracker/connections";
import { getConfiguredAppBaseUrl } from "@/lib/app-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_PROJECT_COOKIE = "agx-tracker-auth-project";

function redirect(path: string) {
  return NextResponse.redirect(new URL(path, getConfiguredAppBaseUrl()));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const projectId = req.cookies.get(AUTH_PROJECT_COOKIE)?.value?.trim();

  if (!projectId) {
    return redirect("/?tracker=error&reason=missing_project");
  }

  const adapter = resolveAdapter(tracker);

  if (!adapter.handleTokenDelivery) {
    return redirect("/?tracker=error&reason=unsupported");
  }

  const tokenParams: Record<string, string> = {};
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    tokenParams[key] = value;
  }

  try {
    await adapter.handleTokenDelivery(projectId, tokenParams);

    addTrackerConnection(projectId, {
      type: tracker,
      connectedAt: new Date().toISOString(),
    });

    const response = redirect("/?tracker=connected");
    response.cookies.delete(AUTH_PROJECT_COOKIE);
    return response;
  } catch {
    return redirect(`/?${tracker}=error`);
  }
}

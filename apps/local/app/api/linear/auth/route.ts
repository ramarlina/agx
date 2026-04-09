import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Redirect to agx-web which owns the Linear OAuth credentials
  const url = new URL(req.url);
  const localPort = url.port || "3000";

  return NextResponse.redirect(
    `https://www.runagx.com/integrations/linear/auth?port=${localPort}`,
  );
}

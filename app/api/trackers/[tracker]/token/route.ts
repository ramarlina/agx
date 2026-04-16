import { NextRequest, NextResponse } from "next/server";
import "@/lib/tracker"; // Ensure adapters are registered
import { badRequest } from "@/lib/tracker/route-helpers";
import { saveProjectTicketToken } from "@/lib/tracker/adapters/linear/client";
import { addTrackerConnection } from "@/lib/tracker/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string }> }
) {
  const { tracker } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    accessToken?: string;
  };

  const projectId = body.projectId?.trim();
  const accessToken = body.accessToken?.trim();

  if (!projectId) return badRequest("projectId required");
  if (!accessToken) return badRequest("accessToken required");

  saveProjectTicketToken(projectId, tracker, { accessToken });

  addTrackerConnection(projectId, {
    type: tracker,
    connectedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
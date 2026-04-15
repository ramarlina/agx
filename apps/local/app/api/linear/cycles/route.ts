import { NextRequest, NextResponse } from "next/server";
import { getLinearClient } from "@/lib/linear-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const client = getLinearClient(projectId);
  if (!client) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  try {
    const cycles = await client.cycles();
    return NextResponse.json({ cycles });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch cycles" },
      { status: 500 },
    );
  }
}

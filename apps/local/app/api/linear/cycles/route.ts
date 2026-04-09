import { NextResponse } from "next/server";
import { getLinearClient } from "@/lib/linear-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = getLinearClient();
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

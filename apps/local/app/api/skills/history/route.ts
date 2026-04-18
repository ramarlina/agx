import { NextRequest, NextResponse } from "next/server";
import { listSkillHistory } from "@/lib/skills-library";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const provider = searchParams.get("provider") ?? undefined;
    const history = listSkillHistory(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50, provider);
    return NextResponse.json({ ok: true, history });
  } catch (error) {
    logger.error("Error fetching skill history", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch skill history" }, { status: 500 });
  }
}

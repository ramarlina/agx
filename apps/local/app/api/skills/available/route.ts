import { NextRequest, NextResponse } from "next/server";
import { listAvailableSkills, listInstalledSkillIds } from "@/lib/skills-library";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") ?? undefined;
    return NextResponse.json({
      ok: true,
      installed: listInstalledSkillIds(),
      skills: listAvailableSkills(provider),
    });
  } catch (error) {
    logger.error("Error fetching available skills", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch available skills" }, { status: 500 });
  }
}

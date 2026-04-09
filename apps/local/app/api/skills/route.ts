import { NextRequest, NextResponse } from "next/server";
import { fetchSkillsCatalog, listAvailableSkills, listInstalledSkillIds } from "@/lib/skills-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const [skills, installedIds, available] = await Promise.all([
      fetchSkillsCatalog(),
      Promise.resolve(listInstalledSkillIds()),
      Promise.resolve(listAvailableSkills()),
    ]);
    return NextResponse.json({ skills, installed: installedIds, available });
  } catch (error) {
    console.error("Error fetching skills catalog:", error);
    return NextResponse.json({ error: "Failed to fetch skills catalog" }, { status: 500 });
  }
}

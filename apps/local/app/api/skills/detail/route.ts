import { NextRequest, NextResponse } from "next/server";
import { fetchSkillDetail } from "@/lib/skills-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source")?.trim() ?? "";
  const skillId = searchParams.get("skillId")?.trim() ?? "";

  if (!source || !skillId) {
    return NextResponse.json({ error: "source and skillId are required" }, { status: 400 });
  }

  try {
    const detail = await fetchSkillDetail(source, skillId);
    return NextResponse.json({ ok: Boolean(detail), detail });
  } catch (error) {
    console.error("Error fetching skill detail:", error);
    return NextResponse.json({ error: "Failed to fetch skill detail" }, { status: 500 });
  }
}

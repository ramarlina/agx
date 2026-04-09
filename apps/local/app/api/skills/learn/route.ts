import { NextRequest, NextResponse } from "next/server";
import { installSkill } from "@/lib/skills-library";
import type { ChatProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
    const providers = Array.isArray(body.providers)
      ? body.providers.filter((value: unknown): value is ChatProvider => typeof value === "string")
      : [];

    if (!repo || !skillId) {
      return NextResponse.json({ error: "repo and skillId are required" }, { status: 400 });
    }

    const result = installSkill({ repo, skillId, providers });
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Failed to install skill", result }, { status: 409 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Error installing skill:", error);
    return NextResponse.json({ error: "Failed to install skill" }, { status: 500 });
  }
}

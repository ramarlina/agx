import { NextRequest, NextResponse } from "next/server";
import { removeSkill } from "@/lib/skills-library";
import type { ChatProvider } from "@/lib/types";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/parse-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
    const providers = Array.isArray(body.providers)
      ? body.providers.filter((value: unknown): value is ChatProvider => typeof value === "string")
      : [];

    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }

    const result = removeSkill({ skillId, providers });
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Failed to remove skill", result }, { status: 409 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logger.error("Error removing skill", logger.formatError(error));
    return NextResponse.json({ error: "Failed to remove skill" }, { status: 500 });
  }
}

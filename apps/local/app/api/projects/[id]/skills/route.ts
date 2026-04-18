import { NextRequest, NextResponse } from "next/server";
import { getProjectSkills, addProjectSkill, removeProjectSkill } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/skills — list skills for a project */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const skills = await getProjectSkills(projectId);
    return NextResponse.json({ skills });
  } catch (error) {
    logger.error("Error fetching project skills", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch project skills" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/skills — add a skill to the project */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const file = typeof body.file === "string" ? body.file.trim() : "";

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const condition = typeof body.condition === "string" ? body.condition.trim() : undefined;
    const skill = await addProjectSkill(projectId, file, condition);
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    logger.error("Error adding project skill", logger.formatError(error));
    return NextResponse.json({ error: "Failed to add project skill" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/skills?skillId=<id> — remove a skill */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const skillId = new URL(request.url).searchParams.get("skillId");
    if (!skillId) {
      return NextResponse.json({ error: "skillId query param is required" }, { status: 400 });
    }

    await removeProjectSkill(skillId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error removing project skill", logger.formatError(error));
    return NextResponse.json({ error: "Failed to remove project skill" }, { status: 500 });
  }
}

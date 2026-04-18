import { NextRequest, NextResponse } from "next/server";
import { getAgentSkills, setAgentSkills } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/agents/[id]/skills — list skills for an agent */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: agentId } = await context.params;
    const skills = await getAgentSkills(agentId);
    return NextResponse.json({ skills });
  } catch (error) {
    logger.error("Error fetching agent skills", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch agent skills" }, { status: 500 });
  }
}

/** PUT /api/agents/[id]/skills — replace all skills for an agent */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id: agentId } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (!Array.isArray(body.skills)) {
      return NextResponse.json({ error: "skills array is required" }, { status: 400 });
    }

    const skills = await setAgentSkills(agentId, body.skills);
    return NextResponse.json({ skills });
  } catch (error) {
    logger.error("Error setting agent skills", logger.formatError(error));
    return NextResponse.json({ error: "Failed to set agent skills" }, { status: 500 });
  }
}

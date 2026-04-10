import { NextRequest, NextResponse } from "next/server";
import { getTeamAgents, addTeamAgent, removeTeamAgent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; teamId: string }> };

/** GET /api/projects/[id]/teams/[teamId]/agents — list agents in a team */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const agents = await getTeamAgents(teamId);
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error fetching team agents:", error);
    return NextResponse.json({ error: "Failed to fetch team agents" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/teams/[teamId]/agents — add an agent to the team */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const roleKey = typeof body.roleKey === "string" ? body.roleKey.trim() : "member";

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    await addTeamAgent(teamId, agentId, roleKey, body.routingOrder);
    const agents = await getTeamAgents(teamId);
    return NextResponse.json({ agents }, { status: 201 });
  } catch (error) {
    console.error("Error adding agent to team:", error);
    return NextResponse.json({ error: "Failed to add agent to team" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/teams/[teamId]/agents?agentId=<id> — remove agent from team */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const agentId = new URL(request.url).searchParams.get("agentId");

    if (!agentId) {
      return NextResponse.json({ error: "agentId query param is required" }, { status: 400 });
    }

    await removeTeamAgent(teamId, agentId);
    const agents = await getTeamAgents(teamId);
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error removing agent from team:", error);
    return NextResponse.json({ error: "Failed to remove agent from team" }, { status: 500 });
  }
}

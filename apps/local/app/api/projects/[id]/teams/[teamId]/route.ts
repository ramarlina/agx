import { NextRequest, NextResponse } from "next/server";
import { getTeam, getTeamAgents, updateTeam, deleteTeam } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; teamId: string }> };

/** GET /api/projects/[id]/teams/[teamId] — get a single team with agents */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const team = await getTeam(teamId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const agents = await getTeamAgents(teamId);
    return NextResponse.json({ team: { ...team, agents } });
  } catch (error) {
    console.error("Error fetching team:", error);
    return NextResponse.json({ error: "Failed to fetch team" }, { status: 500 });
  }
}

/** PATCH /api/projects/[id]/teams/[teamId] — update team name/metadata */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const body = await request.json().catch(() => ({}));

    const updates: { name?: string; metadata?: Record<string, unknown> } = {};
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (body.metadata && typeof body.metadata === "object") updates.metadata = body.metadata;

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const team = await updateTeam(teamId, updates);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const agents = await getTeamAgents(teamId);
    return NextResponse.json({ team: { ...team, agents } });
  } catch (error) {
    console.error("Error updating team:", error);
    return NextResponse.json({ error: "Failed to update team" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/teams/[teamId] — delete a team */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    await deleteTeam(teamId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting team:", error);
    return NextResponse.json({ error: "Failed to delete team" }, { status: 500 });
  }
}

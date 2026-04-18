import { NextRequest, NextResponse } from "next/server";
import { getTeams, getTeamAgents } from "@/lib/db";
import { serializeTeams } from "@/lib/team-yaml";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/teams/export — export all teams as YAML */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const teams = await getTeams(projectId);

    const teamsWithAgents = await Promise.all(
      teams.map(async (team) => ({
        ...team,
        agents: await getTeamAgents(team.id),
      }))
    );

    const yaml = serializeTeams(teamsWithAgents);

    return new NextResponse(yaml, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="teams-${projectId}.yaml"`,
      },
    });
  } catch (error) {
    logger.error("Error exporting teams", logger.formatError(error));
    return NextResponse.json({ error: "Failed to export teams" }, { status: 500 });
  }
}

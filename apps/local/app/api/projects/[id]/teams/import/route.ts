import { NextRequest, NextResponse } from "next/server";
import {
  getTeams,
  getTeamAgents,
  deleteTeam,
  createTeam,
  addTeamAgent,
} from "@/lib/db";
import { deserializeTeams } from "@/lib/team-yaml";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/projects/[id]/teams/import — import teams from YAML, replacing existing teams */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const yamlBody = await request.text();
    if (!yamlBody.trim()) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    let doc;
    try {
      doc = deserializeTeams(yamlBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid YAML";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Delete existing teams for the project
    const existingTeams = await getTeams(projectId);
    for (const team of existingTeams) {
      await deleteTeam(team.id);
    }

    // Create new teams + agents from the YAML document
    const createdTeams = [];
    for (const entry of doc.teams) {
      const team = await createTeam(
        projectId,
        entry.name,
        entry.template_id ?? undefined,
      );

      for (const agent of entry.agents) {
        await addTeamAgent(team.id, agent.agent_id, agent.role_key, agent.routing_order);
      }

      const agents = await getTeamAgents(team.id);
      createdTeams.push({ ...team, agents });
    }

    return NextResponse.json({ success: true, teams: createdTeams });
  } catch (error) {
    logger.error("Error importing teams", logger.formatError(error));
    return NextResponse.json({ error: "Failed to import teams" }, { status: 500 });
  }
}

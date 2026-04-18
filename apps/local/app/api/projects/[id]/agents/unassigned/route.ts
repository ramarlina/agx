import { NextRequest, NextResponse } from "next/server";
import {
  getProjectAgents,
  getTeams,
  getTeamAgents,
  getAgent,
  getAgentSkills,
} from "@/lib/db";
import { LOCAL_USER } from "@/lib/auth-mode";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/agents/unassigned — agents not in any team */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const [projectAgents, teams] = await Promise.all([
      getProjectAgents(projectId),
      getTeams(projectId),
    ]);

    // Collect all agent IDs that belong to at least one team
    const teamAgentLists = await Promise.all(
      teams.map((team) => getTeamAgents(team.id))
    );
    const assignedIds = new Set(
      teamAgentLists.flat().map((ta) => ta.agent_id)
    );

    // Filter to unassigned only
    const unassignedProjectAgents = projectAgents.filter(
      (pa) => !assignedIds.has(pa.agent_id)
    );

    // Fetch full agent records + skills in parallel
    const agents = await Promise.all(
      unassignedProjectAgents.map(async (pa) => {
        const [agent, skills] = await Promise.all([
          getAgent(pa.agent_id, LOCAL_USER.id),
          getAgentSkills(pa.agent_id),
        ]);
        if (!agent) return null;
        return {
          id: agent.id,
          name: agent.name,
          style: agent.style,
          skills: skills.map((s) => ({ file: s.file, condition: s.condition })),
        };
      })
    );

    return NextResponse.json({
      agents: agents.filter(Boolean),
    });
  } catch (error) {
    logger.error("Error fetching unassigned agents", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to fetch unassigned agents" },
      { status: 500 }
    );
  }
}

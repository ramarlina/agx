import { NextRequest, NextResponse } from "next/server";
import {
  getTeams,
  getTeamAgents,
  createTeam,
  addTeamAgent,
  createAgent,
  setAgentSkills,
} from "@/lib/db";
import { getTeamTemplate, getAgentPresetBindings } from "@/lib/team-catalog";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { TeamTemplateId } from "@/lib/team-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/teams — list teams for a project with their agents */
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

    return NextResponse.json({ teams: teamsWithAgents });
  } catch (error) {
    console.error("Error fetching teams:", error);
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/teams — create a team (optionally from template) */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));

    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : undefined;

    // If templateId provided, expand from catalog
    if (templateId) {
      const template = getTeamTemplate(templateId as TeamTemplateId);
      if (!template) {
        return NextResponse.json({ error: `Unknown template: ${templateId}` }, { status: 400 });
      }

      const teamName = name || template.name;
      const team = await createTeam(projectId, teamName, templateId, {
        icon: template.icon,
        description: template.description,
      });

      // Create agents from template presets and wire them to the team
      for (let i = 0; i < template.agents.length; i++) {
        const preset = template.agents[i];
        const agent = await createAgent(LOCAL_USER.id, {
          name: preset.name,
          title: preset.title,
          style: preset.style,
          voice: preset.identity,
        });

        // Attach skill bindings from profile + extraSkills
        const bindings = getAgentPresetBindings(preset);
        if (bindings.length > 0) {
          await setAgentSkills(
            agent.id,
            bindings.map((b) => ({
              file: `${b.repo}/${b.skillId}`,
              ...(b.condition ? { condition: b.condition } : {}),
            })),
          );
        }

        await addTeamAgent(team.id, agent.id, preset.roleKey, i);
      }

      const agents = await getTeamAgents(team.id);
      return NextResponse.json({ team: { ...team, agents } }, { status: 201 });
    }

    // Custom team (no template)
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const team = await createTeam(projectId, name);
    return NextResponse.json({ team: { ...team, agents: [] } }, { status: 201 });
  } catch (error) {
    console.error("Error creating team:", error);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}

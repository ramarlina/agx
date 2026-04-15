import { NextRequest, NextResponse } from "next/server";
import {
  getTeams,
  getTeamAgents,
  createTeam,
  addTeamAgent,
  addProjectAgent,
  createAgent,
  setAgentSkills,
} from "@/lib/db";
import {
  getTeamTemplate,
  getTemplateVariant,
  getAgentPreset,
  getAgentPresetBindings,
} from "@/lib/team-catalog";
import { setAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { TeamTemplateId, AgentPresetId, AgentPreset } from "@/lib/team-catalog";
import type { Skill, SkillBinding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type RequestedAgent = {
  preset: AgentPreset;
  name?: string;
  role?: string;
  identity?: string;
  provider?: string;
  model?: string;
  color?: string;
  skills?: Skill[];
  skillBindings?: SkillBinding[];
};

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

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toSkills(value: unknown): Skill[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const skills = value
    .map((item: unknown) => {
      if (typeof item === "string") return { file: item.trim(), condition: "" };
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const file = String(obj.file ?? "").trim();
      if (!file) return null;
      return {
        file,
        condition: String(obj.condition ?? "").trim(),
      };
    })
    .filter((skill): skill is Skill => Boolean(skill?.file));
  return skills.length > 0 ? skills : undefined;
}

function toSkillBindings(value: unknown): SkillBinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const bindings = value
    .map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const repo = String(obj.repo ?? "").trim();
      const skillId = String(obj.skillId ?? obj.skill_id ?? "").trim();
      if (!repo || !skillId) return null;
      const condition = String(obj.condition ?? "").trim();
      return {
        repo,
        skillId,
        ...(condition ? { condition } : {}),
      };
    })
    .filter((binding): binding is SkillBinding => Boolean(binding));
  return bindings.length > 0 ? bindings : undefined;
}

function resolveRequestedAgents(value: unknown): { agents?: RequestedAgent[]; error?: string } {
  if (!Array.isArray(value)) return {};

  const resolved: RequestedAgent[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const preset = getAgentPreset(entry as AgentPresetId);
      if (!preset) return { error: `Unknown preset: ${entry}` };
      resolved.push({ preset });
      continue;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "agents must be an array of preset ids or agent objects" };
    }

    const obj = entry as Record<string, unknown>;
    const roleId = toOptionalString(obj.roleId) ?? toOptionalString(obj.presetId);
    if (!roleId) {
      return { error: "Each agent must include roleId" };
    }

    const preset = getAgentPreset(roleId as AgentPresetId);
    if (!preset) return { error: `Unknown preset: ${roleId}` };

    resolved.push({
      preset,
      name: toOptionalString(obj.name),
      role: toOptionalString(obj.role),
      identity: toOptionalString(obj.identity),
      provider: toOptionalString(obj.provider),
      model: toOptionalString(obj.model),
      color: toOptionalString(obj.color),
      skills: toSkills(obj.skills),
      skillBindings: toSkillBindings(obj.skillBindings),
    });
  }

  return { agents: resolved };
}

async function provisionAgent(requested: RequestedAgent, projectId: string, teamId: string, order: number) {
  const { preset } = requested;
  const identity = requested.identity ?? preset.identity;
  const agent = await createAgent(LOCAL_USER.id, {
    name: requested.name ?? preset.name,
    role: requested.role ?? preset.role,
    style: preset.style,
    description: identity,
    voice: identity,
    provider: requested.provider,
    model: requested.model,
    color: requested.color,
  });

  const defaultBindings = getAgentPresetBindings(preset).map((binding) => ({
    repo: binding.repo,
    skillId: binding.skillId,
    ...(binding.condition ? { condition: binding.condition } : {}),
  }));

  await setAgentSkills(agent.id, requested.skills ?? []);
  await setAgentSkillBindings(agent.id, requested.skillBindings ?? defaultBindings);

  await addTeamAgent(teamId, agent.id, preset.id, order);
  await addProjectAgent(projectId, agent.id, order);
  return agent;
}

/**
 * POST /api/projects/[id]/teams — create a team
 *
 * Body options:
 *   { templateId, variantId?, name? }         — from template/variant
 *   { templateId, agents: AgentPresetId[] }   — template with custom preset selection
 *   { name }                                  — empty custom team
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));

    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : undefined;
    const variantId = typeof body.variantId === "string" ? body.variantId.trim() : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const requestedAgents = resolveRequestedAgents(body.agents);
    if (requestedAgents.error) {
      return NextResponse.json({ error: requestedAgents.error }, { status: 400 });
    }

    if (templateId && templateId !== "__custom__") {
      const template = getTeamTemplate(templateId as TeamTemplateId);
      if (!template) {
        return NextResponse.json({ error: `Unknown template: ${templateId}` }, { status: 400 });
      }

      // Determine which presets to use: custom list > variant > template default
      let agentsToProvision: RequestedAgent[];
      let teamName: string;
      let metadata: Record<string, unknown> = {
        icon: template.icon,
        description: template.description,
      };

      if (requestedAgents.agents && requestedAgents.agents.length > 0) {
        agentsToProvision = requestedAgents.agents;
        teamName = name || template.name;
      } else if (variantId) {
        const variant = getTemplateVariant(templateId as TeamTemplateId, variantId);
        if (!variant) {
          return NextResponse.json({ error: `Unknown variant: ${variantId}` }, { status: 400 });
        }
        agentsToProvision = variant.agents.map((preset) => ({ preset }));
        teamName = name || variant.name;
        metadata.variantId = variantId;
        metadata.description = variant.description;
      } else {
        agentsToProvision = template.agents.map((preset) => ({ preset }));
        teamName = name || template.name;
      }

      if (requestedAgents.agents && requestedAgents.agents.length > 0) {
        if (variantId) {
          metadata.variantId = variantId;
        } else {
          metadata.variantId = "custom";
        }
      }

      const team = await createTeam(projectId, teamName, templateId, metadata);

      for (let i = 0; i < agentsToProvision.length; i++) {
        await provisionAgent(agentsToProvision[i], projectId, team.id, i);
      }

      const agents = await getTeamAgents(team.id);
      return NextResponse.json({ team: { ...team, agents } }, { status: 201 });
    }

    // Custom team (no template)
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const team = await createTeam(projectId, name);
    if (requestedAgents.agents && requestedAgents.agents.length > 0) {
      for (let i = 0; i < requestedAgents.agents.length; i++) {
        await provisionAgent(requestedAgents.agents[i], projectId, team.id, i);
      }
    }

    const agents = await getTeamAgents(team.id);
    return NextResponse.json({ team: { ...team, agents } }, { status: 201 });
  } catch (error) {
    console.error("Error creating team:", error);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}

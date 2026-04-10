import { dump, load } from "js-yaml";
import type { Team, TeamAgent } from "./db";

export interface TeamYamlAgent {
  role_key: string;
  agent_id: string;
  routing_order: number;
}

export interface TeamYamlEntry {
  name: string;
  template_id: string | null;
  agents: TeamYamlAgent[];
}

export interface TeamYamlDocument {
  version: 1;
  teams: TeamYamlEntry[];
}

export function serializeTeams(teams: Array<Team & { agents: TeamAgent[] }>): string {
  const doc: TeamYamlDocument = {
    version: 1,
    teams: teams.map((team) => ({
      name: team.name,
      template_id: team.template_id,
      agents: team.agents.map((agent) => ({
        role_key: agent.role_key,
        agent_id: agent.agent_id,
        routing_order: agent.routing_order,
      })),
    })),
  };

  return dump(doc, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

export function deserializeTeams(yaml: string): TeamYamlDocument {
  const parsed = load(yaml);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid YAML: expected an object at the root level");
  }

  const doc = parsed as Record<string, unknown>;

  if (doc.version !== 1) {
    throw new Error(`Unsupported version: ${doc.version ?? "missing"}. Only version 1 is supported.`);
  }

  if (!Array.isArray(doc.teams)) {
    throw new Error("Invalid YAML: missing or invalid 'teams' array");
  }

  const teams: TeamYamlEntry[] = doc.teams.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid team entry at index ${index}`);
    }

    const t = entry as Record<string, unknown>;

    if (typeof t.name !== "string" || t.name.trim().length === 0) {
      throw new Error(`Invalid or missing 'name' for team at index ${index}`);
    }

    const templateId = t.template_id === undefined || t.template_id === null
      ? null
      : typeof t.template_id === "string"
        ? t.template_id
        : (() => { throw new Error(`Invalid 'template_id' for team at index ${index}`); })();

    const agents: TeamYamlAgent[] = Array.isArray(t.agents)
      ? t.agents.map((a: unknown, ai: number) => {
          if (!a || typeof a !== "object" || Array.isArray(a)) {
            throw new Error(`Invalid agent at index ${ai} in team '${t.name}'`);
          }

          const ag = a as Record<string, unknown>;

          if (typeof ag.role_key !== "string") {
            throw new Error(`Invalid or missing 'role_key' for agent at index ${ai} in team '${t.name}'`);
          }
          if (typeof ag.agent_id !== "string") {
            throw new Error(`Invalid or missing 'agent_id' for agent at index ${ai} in team '${t.name}'`);
          }
          if (typeof ag.routing_order !== "number") {
            throw new Error(`Invalid or missing 'routing_order' for agent at index ${ai} in team '${t.name}'`);
          }

          return {
            role_key: ag.role_key,
            agent_id: ag.agent_id,
            routing_order: ag.routing_order,
          };
        })
      : [];

    return {
      name: t.name,
      template_id: templateId,
      agents,
    };
  });

  return { version: 1, teams };
}

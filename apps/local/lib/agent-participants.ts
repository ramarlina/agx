import { getAgents, getAgentSkills } from "@/lib/db";
import { getAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { ChatProvider, Participant } from "@/lib/types";

export async function loadDbParticipants(): Promise<Participant[]> {
  const agents = await getAgents(LOCAL_USER.id);
  const skillsByAgent = new Map<string, Awaited<ReturnType<typeof getAgentSkills>>>();
  const bindingsByAgent = new Map<string, Awaited<ReturnType<typeof getAgentSkillBindings>>>();
  await Promise.all(
    agents.map(async (agent) => {
      skillsByAgent.set(agent.id, await getAgentSkills(agent.id));
      bindingsByAgent.set(agent.id, await getAgentSkillBindings(agent.id));
    })
  );

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    ...(agent.title ? { title: agent.title } : {}),
    provider: (agent.provider || "claude") as ChatProvider,
    model: agent.model || null,
    color: agent.color || "#6B7280",
    ...(agent.description ? { identity: agent.description } : {}),
    ...(agent.voice ? { voice: agent.voice } : {}),
    ...(agent.seed ? { seed: agent.seed } : {}),
    ...(skillsByAgent.get(agent.id)?.length
      ? {
        skills: skillsByAgent.get(agent.id)!.map((skill) => ({
          file: skill.file,
          condition: skill.condition ?? "",
        })),
      }
      : {}),
    ...(bindingsByAgent.get(agent.id)?.length ? { skillBindings: bindingsByAgent.get(agent.id) } : {}),
  }));
}

export function filterActiveParticipants(
  participants: Participant[],
  activeParticipantIds: unknown
): Participant[] {
  if (!Array.isArray(activeParticipantIds)) {
    return participants;
  }

  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const value of activeParticipantIds) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    orderedIds.push(trimmed);
  }

  const activeIdSet = new Set(orderedIds);
  const filtered = participants.filter((participant) => activeIdSet.has(participant.id));
  if (orderedIds.length > 0 && filtered.length === 0) {
    return participants;
  }

  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  return filtered.sort(
    (a, b) =>
      (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

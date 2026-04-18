import { createAdminDbClient } from "../db-adapter";
import { isMissingRelationError } from "./shared";
import type { Agent, AgentSkill, AgentStyle } from "./types";

export async function getAgents(userId: string): Promise<Agent[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error, "agents")) return [];
    throw error;
  }
  return data || [];
}

export async function getAgent(id: string, userId: string): Promise<Agent | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("agents")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116" || isMissingRelationError(error, "agents")) return null;
    throw error;
  }
  return data;
}

export async function getAgentSkills(agentId: string): Promise<AgentSkill[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("agent_skills")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "agent_skills")) return [];
    throw error;
  }
  return data || [];
}

export async function setAgentSkills(
  agentId: string,
  skills: Array<{ file: string; condition?: string }>
): Promise<AgentSkill[]> {
  const db = createAdminDbClient();
  const normalized = new Map<string, { agent_id: string; file: string; condition: string | null }>();
  for (const skill of skills) {
    const file = skill.file.trim();
    if (!file) continue;
    normalized.set(file, {
      agent_id: agentId,
      file,
      condition: skill.condition?.trim() || null,
    });
  }

  const existing = await getAgentSkills(agentId);
  for (const skill of existing) {
    if (!normalized.has(skill.file)) {
      const { error } = await db
        .from("agent_skills")
        .delete()
        .eq("agent_id", agentId)
        .eq("file", skill.file);
      if (error && !isMissingRelationError(error, "agent_skills")) throw error;
    }
  }

  for (const entry of normalized.values()) {
    const existingSkill = existing.find((skill) => skill.file === entry.file);
    if (!existingSkill) {
      const { error } = await db.from("agent_skills").insert(entry);
      if (error && !isMissingRelationError(error, "agent_skills")) throw error;
      continue;
    }
    if ((existingSkill.condition ?? null) !== entry.condition) {
      const { error } = await db
        .from("agent_skills")
        .update({ condition: entry.condition })
        .eq("agent_id", agentId)
        .eq("file", entry.file);
      if (error && !isMissingRelationError(error, "agent_skills")) throw error;
    }
  }

  return getAgentSkills(agentId);
}

export async function createAgent(
  userId: string,
  input: {
    id?: string;
    name: string;
    role?: string;
    style: AgentStyle;
    description?: string;
    voice?: string;
    seed?: string;
    model?: string;
    provider?: string;
    color?: string;
  }
): Promise<Agent> {
  const db = createAdminDbClient();

  const payload: Record<string, unknown> = {
    user_id: userId,
    name: input.name,
    style: input.style,
    description: input.description ?? null,
  };
  if (input.id !== undefined) payload.id = input.id;
  if (input.role !== undefined) payload.role = input.role;
  if (input.voice !== undefined) payload.voice = input.voice;
  if (input.seed !== undefined) payload.seed = input.seed;
  if (input.model !== undefined) payload.model = input.model;
  if (input.provider !== undefined) payload.provider = input.provider;
  if (input.color !== undefined) payload.color = input.color;

  const { data, error } = await db
    .from("agents")
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (isMissingRelationError(error, "agents")) {
      throw new Error("Agents table does not exist");
    }
    throw error;
  }
  return data;
}

export async function updateAgent(
  id: string,
  userId: string,
  input: {
    name?: string;
    role?: string;
    style?: AgentStyle;
    description?: string;
    voice?: string;
    seed?: string;
    model?: string;
    provider?: string;
    color?: string;
  }
): Promise<Agent | null> {
  const db = createAdminDbClient();

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.role !== undefined) updatePayload.role = input.role;
  if (input.style !== undefined) updatePayload.style = input.style;
  if (input.description !== undefined) updatePayload.description = input.description;
  if (input.voice !== undefined) updatePayload.voice = input.voice;
  if (input.seed !== undefined) updatePayload.seed = input.seed;
  if (input.model !== undefined) updatePayload.model = input.model;
  if (input.provider !== undefined) updatePayload.provider = input.provider;
  if (input.color !== undefined) updatePayload.color = input.color;

  if (Object.keys(updatePayload).length === 1) {
    return getAgent(id, userId);
  }

  const { data, error } = await db
    .from("agents")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116" || isMissingRelationError(error, "agents")) return null;
    throw error;
  }
  return data;
}

export async function deleteAgent(id: string, userId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    if (!isMissingRelationError(error, "agents")) {
      throw error;
    }
  }
}

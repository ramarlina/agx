import { randomUUID } from "crypto";
import { createAdminDbClient } from "../db-adapter";
import { isMissingRelationError } from "./shared";
import type { Team, TeamAgent } from "./types";

export async function getTeams(projectId: string): Promise<Team[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("teams")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "teams")) return [];
    throw error;
  }
  return (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata as string) : (row.metadata || {}),
  })) as Team[];
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116" || isMissingRelationError(error, "teams")) return null;
    throw error;
  }
  if (!data) return null;
  return {
    ...data,
    metadata: typeof data.metadata === "string" ? JSON.parse(data.metadata as string) : (data.metadata || {}),
  } as Team;
}

export async function createTeam(
  projectId: string,
  name: string,
  templateId?: string,
  metadata?: Record<string, unknown>
): Promise<Team> {
  const db = createAdminDbClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("teams")
    .insert({
      id,
      project_id: projectId,
      name,
      template_id: templateId || null,
      metadata: JSON.stringify(metadata || {}),
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return {
    ...data,
    metadata: typeof data.metadata === "string" ? JSON.parse(data.metadata as string) : (data.metadata || {}),
  } as Team;
}

export async function updateTeam(
  teamId: string,
  updates: { name?: string; metadata?: Record<string, unknown> }
): Promise<Team | null> {
  const db = createAdminDbClient();
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.metadata !== undefined) payload.metadata = JSON.stringify(updates.metadata);

  const { data, error } = await db
    .from("teams")
    .update(payload)
    .eq("id", teamId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return {
    ...data,
    metadata: typeof data.metadata === "string" ? JSON.parse(data.metadata as string) : (data.metadata || {}),
  } as Team;
}

export async function deleteTeam(teamId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("teams")
    .delete()
    .eq("id", teamId);
  if (error) throw error;
}

export async function getTeamAgents(teamId: string): Promise<TeamAgent[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("team_agents")
    .select("*")
    .eq("team_id", teamId)
    .order("routing_order", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "team_agents")) return [];
    throw error;
  }
  return data || [];
}

export async function addTeamAgent(
  teamId: string,
  agentId: string,
  roleKey: string,
  routingOrder?: number
): Promise<TeamAgent> {
  const db = createAdminDbClient();

  if (routingOrder === undefined) {
    const { data: existing } = await db
      .from("team_agents")
      .select("routing_order")
      .eq("team_id", teamId)
      .order("routing_order", { ascending: false })
      .limit(1);
    routingOrder = (existing?.[0]?.routing_order ?? -1) + 1;
  }

  const { data, error } = await db
    .from("team_agents")
    .upsert({ team_id: teamId, agent_id: agentId, role_key: roleKey, routing_order: routingOrder })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeTeamAgent(teamId: string, agentId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("team_agents")
    .delete()
    .eq("team_id", teamId)
    .eq("agent_id", agentId);
  if (error) throw error;
}


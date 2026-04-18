import { NextRequest } from "next/server";
import {
  createAgent,
  updateAgent as updateDbAgent,
  deleteAgent,
  setAgentSkills,
} from "@/lib/db";
import { setAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { loadDbParticipants } from "@/lib/agent-participants";
import type { ChatProvider, Participant, Skill, SkillBinding } from "@/lib/types";
import { ensureAgent } from "@/lib/mesh-core/agent";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/participants
 *
 * Reads from DB agents table (single source of truth for agent identity).
 * Portable agent skills live with the agent; project resources are injected at execution time.
 */
export async function GET() {
  return Response.json(await loadDbParticipants());
}

interface ParticipantPayload {
  id?: unknown;
  name?: unknown;
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  identity?: unknown;
  identityFile?: unknown;
  skills?: unknown;
  skillBindings?: unknown;
  variables?: unknown;
  color?: unknown;
  // New agent-level fields
  voice?: unknown;
  seed?: unknown;
  // Project scoping
  projectId?: unknown;
  // Legacy alias still emitted by some UI paths
  teamId?: unknown;
}

function slugifyParticipantId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toSkills(value: unknown): Skill[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const skills: Skill[] = value
    .map((item: unknown) => {
      if (typeof item === "string") return { file: item.trim(), condition: "" };
      if (item && typeof item === "object" && "file" in item) {
        const obj = item as Record<string, unknown>;
        return { file: String(obj.file ?? "").trim(), condition: String(obj.condition ?? "").trim() };
      }
      return null;
    })
    .filter((s): s is Skill => s !== null && s.file.length > 0);
  return skills.length > 0 ? skills : undefined;
}

function toSkillBindings(value: unknown): SkillBinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const bindings: SkillBinding[] = value
    .map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const repo = String(obj.repo ?? "").trim();
      const skillId = String(obj.skillId ?? obj.skill_id ?? "").trim();
      if (!repo || !skillId) return null;
      const condition = String(obj.condition ?? "").trim();
      return { repo, skillId, ...(condition ? { condition } : {}) };
    })
    .filter((binding): binding is SkillBinding => Boolean(binding));
  return bindings.length > 0 ? bindings : undefined;
}

function toParticipant(body: ParticipantPayload, fallbackId?: string): Participant | null {
  const name = toOptionalString(body.name);
  const provider = toOptionalString(body.provider) as ChatProvider | undefined;
  const model = toOptionalString(body.model);
  const id = toOptionalString(body.id) ?? fallbackId;

  if (!id || !name || !provider || !model) {
    return null;
  }

  const role = toOptionalString(body.role);
  const identity = toOptionalString(body.identity);
  const identityFile = toOptionalString(body.identityFile);
  const skills = toSkills(body.skills);
  const skillBindings = toSkillBindings(body.skillBindings);
  const color = toOptionalString(body.color) ?? "#6B7280";

  let variables: Record<string, string> | undefined;
  if (body.variables && typeof body.variables === "object" && !Array.isArray(body.variables)) {
    const obj = body.variables as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) variables = cleaned;
  }

  return {
    id,
    name,
    provider,
    model,
    color,
    ...(role ? { role } : {}),
    ...(identity ? { identity } : {}),
    ...(toOptionalString(body.voice) ? { voice: toOptionalString(body.voice) } : {}),
    ...(toOptionalString(body.seed) ? { seed: toOptionalString(body.seed) } : {}),
    ...(identityFile ? { identityFile } : {}),
    ...(skills ? { skills } : {}),
    ...(skillBindings ? { skillBindings } : {}),
    ...(variables ? { variables } : {}),
  };
}

/**
 * POST /api/participants
 *
 * Creates a participant in the DB agents table (canonical source).
 * Also auto-assigns to a project if projectId is provided.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ParticipantPayload;
  const name = toOptionalString(body.name);
  const generatedId = name ? slugifyParticipantId(name) : undefined;
  const participant = toParticipant(body, generatedId);

  if (!participant) {
    return Response.json({ error: "name, provider, and model required" }, { status: 400 });
  }

  // Write to DB agents table (canonical source)
  let createdAgent;
  try {
    createdAgent = await createAgent(LOCAL_USER.id, {
      id: participant.id,
      name: participant.name,
      role: participant.role,
      style: "balanced",
      description: participant.identity,
      model: participant.model ?? undefined,
      provider: participant.provider,
      color: participant.color,
      voice: toOptionalString(body.voice),
      seed: toOptionalString(body.seed),
    });
    await setAgentSkills(createdAgent.id, participant.skills ?? []);
    await setAgentSkillBindings(createdAgent.id, participant.skillBindings ?? []);
    ensureAgent(createdAgent.id, {
      voice: toOptionalString(body.voice),
      seed: toOptionalString(body.seed),
    });
  } catch (e) {
    logger.error("Failed to create agent in DB", logger.formatError(e));
    return Response.json({ error: "Failed to create agent" }, { status: 500 });
  }

  const created: Participant = {
    id: createdAgent.id,
    name: createdAgent.name,
    ...(createdAgent.role || participant.role
      ? { role: createdAgent.role || participant.role }
      : {}),
    provider: (createdAgent.provider || participant.provider || "claude") as ChatProvider,
    model: createdAgent.model || participant.model || null,
    color: createdAgent.color || participant.color || "#6B7280",
    ...(createdAgent.description || participant.identity
      ? { identity: createdAgent.description || participant.identity }
      : {}),
    ...(createdAgent.voice || participant.voice
      ? { voice: createdAgent.voice || participant.voice }
      : {}),
    ...(createdAgent.seed || participant.seed
      ? { seed: createdAgent.seed || participant.seed }
      : {}),
    ...(participant.skills?.length ? { skills: participant.skills } : {}),
    ...(participant.skillBindings?.length ? { skillBindings: participant.skillBindings } : {}),
  };

  // Auto-assign to project if projectId provided (teamId kept as legacy alias).
  const projectId = toOptionalString(body.projectId) ?? toOptionalString(body.teamId);
  if (projectId) {
    try {
      const db = getSQLiteDb();
      db.prepare(
        "INSERT OR IGNORE INTO project_agents (project_id, agent_id, routing_order) VALUES (?, ?, (SELECT COALESCE(MAX(routing_order), -1) + 1 FROM project_agents WHERE project_id = ?))"
      ).run(projectId, created.id, projectId);
    } catch (e) {
      logger.error("Failed to assign agent to project", logger.formatError(e));
    }
  }

  return Response.json(created, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ParticipantPayload;
  const participant = toParticipant(body);

  if (!participant) {
    return Response.json({ error: "id, name, provider, and model required" }, { status: 400 });
  }

  // Update DB agents table (canonical source)
  let updatedAgent;
  try {
    updatedAgent = await updateDbAgent(participant.id, LOCAL_USER.id, {
      name: participant.name,
      role: participant.role,
      description: participant.identity,
      model: participant.model ?? undefined,
      provider: participant.provider,
      color: participant.color,
      voice: toOptionalString(body.voice),
      seed: toOptionalString(body.seed),
    });
    await setAgentSkills(participant.id, participant.skills ?? []);
    await setAgentSkillBindings(participant.id, participant.skillBindings ?? []);
    ensureAgent(participant.id, {
      voice: toOptionalString(body.voice),
      seed: toOptionalString(body.seed),
    });
  } catch (e) {
    logger.error("Failed to update agent in DB", logger.formatError(e));
    return Response.json({ error: "Failed to update agent" }, { status: 500 });
  }

  if (!updatedAgent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const updated: Participant = {
    id: updatedAgent.id,
    name: updatedAgent.name,
    ...(updatedAgent.role || participant.role
      ? { role: updatedAgent.role || participant.role }
      : {}),
    provider: (updatedAgent.provider || participant.provider || "claude") as ChatProvider,
    model: updatedAgent.model || participant.model || null,
    color: updatedAgent.color || participant.color || "#6B7280",
    ...(updatedAgent.description || participant.identity
      ? { identity: updatedAgent.description || participant.identity }
      : {}),
    ...(updatedAgent.voice || participant.voice
      ? { voice: updatedAgent.voice || participant.voice }
      : {}),
    ...(updatedAgent.seed || participant.seed
      ? { seed: updatedAgent.seed || participant.seed }
      : {}),
    ...(participant.skills?.length ? { skills: participant.skills } : {}),
    ...(participant.skillBindings?.length ? { skillBindings: participant.skillBindings } : {}),
  };

  return Response.json(updated);
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { orderedIds?: unknown };
  if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id: unknown) => typeof id !== "string")) {
    return Response.json({ error: "orderedIds must be a string array" }, { status: 400 });
  }
  // Reorder is a no-op at the global level — agent ordering is project-scoped
  // via project_agents.routing_order. Return current agents in requested order.
  const agents = await loadDbParticipants();
  const orderMap = new Map((body.orderedIds as string[]).map((id, i) => [id, i]));
  agents.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
  return Response.json(agents);
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  // Remove from DB agents table (canonical source)
  try {
    await deleteAgent(id, LOCAL_USER.id);
  } catch (e) {
    logger.error("Failed to delete agent from DB", logger.formatError(e));
  }

  return Response.json({ ok: true });
}

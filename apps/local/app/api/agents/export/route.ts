import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getAgents, getAgentSkills } from "@/lib/db";
import { getAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { LOCAL_USER } from "@/lib/auth-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

function readSelfMd(agentId: string): string | null {
  const selfPath = join(AGENTS_DIR, agentId, "self.md");
  if (!existsSync(selfPath)) return null;
  const raw = readFileSync(selfPath, "utf-8");
  const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

/** POST /api/agents/export — returns bundle JSON for selected agent IDs */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const agentIds: string[] = Array.isArray(body.agentIds) ? body.agentIds : [];

    if (agentIds.length === 0) {
      return Response.json({ error: "No agents selected" }, { status: 400 });
    }

    const dbAgents = await getAgents(LOCAL_USER.id);
    const selected = dbAgents.filter((a) => agentIds.includes(a.id));

    const agents = await Promise.all(
      selected.map(async (a) => ({
        id: a.id,
        name: a.name,
        provider: a.provider || "claude",
        model: a.model || null,
        color: a.color || "#6B7280",
        identity: a.description || null,
        voice: a.voice || null,
        seed: a.seed || null,
        identityFile: null,
        skills: (await getAgentSkills(a.id)).map((skill) => ({
          file: skill.file,
          condition: skill.condition ?? "",
        })),
        skillBindings: await getAgentSkillBindings(a.id),
        variables: {},
        self: readSelfMd(a.id),
      }))
    );

    return Response.json({ agents });
  } catch (error) {
    console.error("Error exporting agents:", error);
    return Response.json({ error: "Failed to export" }, { status: 500 });
  }
}

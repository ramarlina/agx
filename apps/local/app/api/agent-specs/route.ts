import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getAgents, getAgentSkills } from "@/lib/db";
import { getAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { LOCAL_USER } from "@/lib/auth-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGX_API_URL = process.env.AGX_API_URL || "http://localhost:8080";
const AGENTS_DIR = join(homedir(), ".agx", "agents");

function readSelfMd(agentId: string): string | null {
  const selfPath = join(AGENTS_DIR, agentId, "self.md");
  if (!existsSync(selfPath)) return null;
  const raw = readFileSync(selfPath, "utf-8");
  const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

/** POST /api/agent-specs — push agent(s) to agx-api, get share code */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentIds: string[] = Array.isArray(body.agentIds) ? body.agentIds : [];
    const includeSelf: boolean = body.includeSelf !== false;

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
        self: includeSelf ? readSelfMd(a.id) : null,
      }))
    );

    const payload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      agents,
      projects: [],
    });

    // Push to agx-api
    const res = await fetch(`${AGX_API_URL}/api/v1/agent/specs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": body.userId || "anonymous",
      },
      body: JSON.stringify({ payload }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `agx-api error: ${err}` }, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (error) {
    console.error("Error sharing agent spec:", error);
    return Response.json({ error: "Failed to share" }, { status: 500 });
  }
}

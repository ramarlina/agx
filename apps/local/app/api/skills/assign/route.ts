import { NextRequest, NextResponse } from "next/server";
import { getAgentSkillBindings, setAgentSkillBindings } from "@/lib/agent-skill-bindings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    const condition = typeof body.condition === "string" ? body.condition.trim() : "";

    if (!agentId || !skillId || !repo) {
      return NextResponse.json({ error: "agentId, repo, and skillId are required" }, { status: 400 });
    }

    const existing = await getAgentSkillBindings(agentId);
    const next = existing.some((binding) => binding.repo === repo && binding.skillId === skillId)
      ? existing.map((binding) => (binding.repo === repo && binding.skillId === skillId ? { repo, skillId, condition } : binding))
      : [...existing, { repo, skillId, condition }];

    await setAgentSkillBindings(agentId, next);
    return NextResponse.json({ ok: true, skillBinding: { repo, skillId, condition } });
  } catch (error) {
    console.error("Error assigning skill to agent:", error);
    return NextResponse.json({ error: "Failed to assign skill to agent" }, { status: 500 });
  }
}

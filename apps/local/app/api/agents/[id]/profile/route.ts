import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getAgent, getAgentSkills } from "@/lib/db";
import { getAgentSkillBindings } from "@/lib/agent-skill-bindings";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

interface JournalEntry {
  t: string;
  type?: string;
  observation?: string;
  judgement?: string;
  delta?: string;
  intent?: string;
  id?: string;
  body?: string;
  selfVersion?: number;
  thread?: string;
  action?: string;
}

interface AgentMemoryRow {
  id: string;
  task_id: string;
  memory_type: "outcome" | "decision" | "pattern" | "gotcha";
  content: string;
  created_at: number;
}

function readJsonl(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const agentDir = join(AGENTS_DIR, id);
  const dbAgent = await getAgent(id, LOCAL_USER.id);

  if (!dbAgent && !existsSync(agentDir)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  // Read identity.json
  let identity: Record<string, unknown> = {};
  const identityPath = join(agentDir, "identity.json");
  if (existsSync(identityPath)) {
    try { identity = JSON.parse(readFileSync(identityPath, "utf-8")); } catch (err) { console.error('[agent-profile] failed to load identity.json:', err); }
  }

  // Read self.md (the evolving bio)
  let self = "";
  const selfPath = join(agentDir, "self.md");
  if (existsSync(selfPath)) {
    const raw = readFileSync(selfPath, "utf-8");
    // Strip YAML frontmatter
    const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
    self = match ? match[1].trim() : raw.trim();
  }

  // Read journal.jsonl
  const journal = readJsonl(join(agentDir, "journal.jsonl")) as JournalEntry[];

  // Read activity.jsonl
  const activity = readJsonl(join(agentDir, "activity.jsonl")) as Record<string, unknown>[];
  const reactionCount = readJsonl(join(agentDir, "reactions.jsonl")).length;
  const commentCount = readJsonl(join(agentDir, "comments.jsonl")).length;
  const portableSkills = dbAgent ? await getAgentSkills(dbAgent.id) : [];
  const skillBindings = dbAgent ? await getAgentSkillBindings(dbAgent.id) : [];
  const sqlite = getSQLiteDb();
  const memories = dbAgent
    ? (sqlite
        .prepare(
          `SELECT id, task_id, memory_type, content, created_at
           FROM agent_memory
           WHERE agent_id = ?
           ORDER BY created_at DESC
           LIMIT 25`
        )
        .all(dbAgent.id) as unknown as AgentMemoryRow[])
    : [];

  // Parse self.md frontmatter for version info
  let selfVersion: number | null = null;
  let selfDerivedAt: string | null = null;
  const selfRaw = existsSync(selfPath) ? readFileSync(selfPath, "utf-8") : "";
  const fmMatch = selfRaw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const vMatch = fmMatch[1].match(/version:\s*(\d+)/);
    const dMatch = fmMatch[1].match(/derivedAt:\s*(.+)/);
    if (vMatch) selfVersion = parseInt(vMatch[1]);
    if (dMatch) selfDerivedAt = dMatch[1].trim();
  }

  return Response.json({
    identity: {
      ...identity,
      ...(dbAgent
        ? {
          id: dbAgent.id,
          name: dbAgent.name,
          style: dbAgent.style,
          description: dbAgent.description ?? identity.description,
          voice: dbAgent.voice ?? identity.voice,
          seed: dbAgent.seed ?? identity.seed,
          model: dbAgent.model ?? identity.model,
          provider: dbAgent.provider ?? identity.provider,
          color: dbAgent.color ?? identity.color,
          skills: portableSkills.map((skill) => ({
            file: skill.file,
            condition: skill.condition ?? "",
          })),
          skillBindings,
        }
        : {}),
    },
    self,
    selfVersion,
    selfDerivedAt,
    journal: journal.slice(-50).reverse(), // latest 50, newest first
    activity: activity.slice(-50).reverse(),
    inspectability: {
      identity: {
        editableBySystem: false,
        sources: ["agents table", "identity.json"],
      },
      selfModel: {
        editableBySystem: true,
        sources: ["self.md", "reflection loop"],
      },
      knowledge: {
        agent: {
          portableSkills: portableSkills.map((skill) => ({
            file: skill.file,
            condition: skill.condition ?? "",
            source: "human-authored",
            form: "file-backed",
          })),
          skillBindings: skillBindings.map((binding) => ({
            repo: binding.repo,
            skillId: binding.skillId,
            condition: binding.condition ?? "",
            source: "catalog-bound",
            form: "repo-backed",
          })),
          learnedMemories: memories.map((memory) => ({
            id: memory.id,
            taskId: memory.task_id,
            type: memory.memory_type,
            content: memory.content,
            createdAt: memory.created_at,
            source: "system-derived",
            form: "extracted-candidate",
          })),
        },
      },
      evidence: {
        journalEntries: journal.length,
        activityEvents: activity.length,
        reactions: reactionCount,
        comments: commentCount,
      },
    },
  });
}

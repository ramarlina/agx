import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentIdentity, AgentSelf } from "./types";
import { readSelf } from "./self";
import { readJournal, getAgentThreads } from "./journal";

const AGENTS_DIR = join(homedir(), ".agx", "agents");
const DEFAULT_VOICE = "conversational, concise, practical";
const DEFAULT_SEED = "I evolve through experience and collaboration.";

/** Initialize a new agent with identity seed */
export function initAgent(
  agentId: string,
  voice: string,
  seed: string
): void {
  const dir = join(AGENTS_DIR, agentId);
  if (existsSync(dir)) {
    throw new Error(`Agent ${agentId} already exists`);
  }

  mkdirSync(dir, { recursive: true });

  const identity: AgentIdentity = { name: agentId, voice, seed };
  writeFileSync(join(dir, "identity.json"), JSON.stringify(identity, null, 2) + "\n", "utf-8");
  writeFileSync(join(dir, "journal.jsonl"), "", "utf-8");
  writeFileSync(join(dir, "reactions.jsonl"), "", "utf-8");
  writeFileSync(join(dir, "comments.jsonl"), "", "utf-8");
  writeFileSync(
    join(dir, "self.md"),
    `---\nversion: 0\nderivedAt: ${new Date().toISOString()}\n---\nI am ${agentId}. ${seed}\n`,
    "utf-8"
  );
}

/** Ensure runtime artifacts exist for an agent (idempotent). */
export function ensureAgent(
  agentId: string,
  options?: { voice?: string; seed?: string }
): void {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const voice = options?.voice?.trim() || DEFAULT_VOICE;
  const seed = options?.seed?.trim() || DEFAULT_SEED;
  const identityPath = join(dir, "identity.json");
  if (!existsSync(identityPath)) {
    const identity: AgentIdentity = { name: agentId, voice, seed };
    writeFileSync(identityPath, JSON.stringify(identity, null, 2) + "\n", "utf-8");
  }

  const journal = join(dir, "journal.jsonl");
  const reactions = join(dir, "reactions.jsonl");
  const comments = join(dir, "comments.jsonl");
  const activity = join(dir, "activity.jsonl");
  const self = join(dir, "self.md");

  if (!existsSync(journal)) writeFileSync(journal, "", "utf-8");
  if (!existsSync(reactions)) writeFileSync(reactions, "", "utf-8");
  if (!existsSync(comments)) writeFileSync(comments, "", "utf-8");
  if (!existsSync(activity)) writeFileSync(activity, "", "utf-8");
  if (!existsSync(self)) {
    writeFileSync(
      self,
      `---\nversion: 0\nderivedAt: ${new Date().toISOString()}\n---\nI am ${agentId}. ${seed}\n`,
      "utf-8"
    );
  }
}

/** Read agent identity */
export function readIdentity(agentId: string): AgentIdentity | null {
  const path = join(AGENTS_DIR, agentId, "identity.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** List all agent IDs (directory existence = agent existence) */
export function listAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Check if an agent exists */
export function agentExists(agentId: string): boolean {
  return existsSync(join(AGENTS_DIR, agentId));
}

/** Get all agents' self snapshots (team context for reflection) */
export function getTeamSelves(excludeAgent?: string): AgentSelf[] {
  return listAgents()
    .filter((id) => id !== excludeAgent)
    .map((id) => readSelf(id))
    .filter((s): s is AgentSelf => s !== null);
}

/** Composite profile view */
export function getProfile(agentId: string): {
  identity: AgentIdentity | null;
  self: AgentSelf | null;
  recentPosts: ReturnType<typeof readJournal>;
  threadCount: number;
} {
  const identity = readIdentity(agentId);
  const self = readSelf(agentId);
  const recentPosts = readJournal(agentId, 10);
  const threads: string[] = getAgentThreads(agentId);
  return { identity, self, recentPosts, threadCount: threads.length };
}

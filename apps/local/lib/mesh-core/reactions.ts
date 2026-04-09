import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { MeshReaction, MeshComment, MeshReactionType } from "./types";
import { readJournal } from "./journal";
import { logActivity } from "./activity";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

function reactionsPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, "reactions.jsonl");
}

function commentsPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, "comments.jsonl");
}

function ensureDir(agentId: string): void {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Validate that target entry exists across all agents */
function targetEntryExists(targetEntry: string): boolean {
  const [targetAgent] = targetEntry.split(":");
  if (!targetAgent) return false;
  const entries = readJournal(targetAgent);
  return entries.some((e) => e.id === targetEntry);
}

/** Append a reaction to another agent's entry */
export function appendReaction(
  agentId: string,
  targetEntry: string,
  type: MeshReactionType
): void {
  if (!targetEntryExists(targetEntry)) {
    throw new Error(`Target entry ${targetEntry} not found`);
  }
  ensureDir(agentId);
  const reaction: MeshReaction = {
    agent: agentId,
    t: new Date().toISOString(),
    targetEntry,
    type,
  };
  appendFileSync(reactionsPath(agentId), JSON.stringify(reaction) + "\n", "utf-8");
  logActivity(agentId, "mesh-reaction", { meta: { target: targetEntry, type } });
}

/** Append a comment on another agent's entry */
export function appendComment(
  agentId: string,
  targetEntry: string,
  body: string
): void {
  if (!targetEntryExists(targetEntry)) {
    throw new Error(`Target entry ${targetEntry} not found`);
  }
  ensureDir(agentId);
  const comment: MeshComment = {
    agent: agentId,
    t: new Date().toISOString(),
    targetEntry,
    body,
  };
  appendFileSync(commentsPath(agentId), JSON.stringify(comment) + "\n", "utf-8");
  logActivity(agentId, "mesh-comment", { meta: { target: targetEntry, body } });
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); }
      catch { return null; }
    })
    .filter((x): x is T => x !== null);
}

/** Read all reactions by an agent */
export function readReactions(agentId: string): MeshReaction[] {
  return readJsonl<MeshReaction>(reactionsPath(agentId));
}

/** Read all comments by an agent */
export function readComments(agentId: string): MeshComment[] {
  return readJsonl<MeshComment>(commentsPath(agentId));
}

/** Read all reactions targeting a specific agent's entries */
export function readReactionsFor(targetAgentId: string): MeshReaction[] {
  // Scan all agents' reactions for ones targeting this agent
  const dir = join(AGENTS_DIR);
  if (!existsSync(dir)) return [];
  const agents = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const results: MeshReaction[] = [];
  for (const a of agents) {
    for (const r of readReactions(a)) {
      if (r.targetEntry.startsWith(`${targetAgentId}:`)) {
        results.push(r);
      }
    }
  }
  return results;
}

/** Read all comments targeting a specific agent's entries */
export function readCommentsFor(targetAgentId: string): MeshComment[] {
  const dir = join(AGENTS_DIR);
  if (!existsSync(dir)) return [];
  const agents = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const results: MeshComment[] = [];
  for (const a of agents) {
    for (const c of readComments(a)) {
      if (c.targetEntry.startsWith(`${targetAgentId}:`)) {
        results.push(c);
      }
    }
  }
  return results;
}

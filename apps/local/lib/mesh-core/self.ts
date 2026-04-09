import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentSelf, AgentIdentity, JournalEntry } from "./types";
import { logActivity } from "./activity";
import type { KnowledgeEntry, KnowledgeKind } from "../knowledge-store";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

function selfPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, "self.md");
}

function reflectionStatePath(agentId: string): string {
  return join(AGENTS_DIR, agentId, "reflection-state.json");
}

export interface ReflectionState {
  lastProcessedJournalId: string | null;
  updatedAt: string;
}

/** Read the current self snapshot */
export function readSelf(agentId: string): AgentSelf | null {
  const path = selfPath(agentId);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) return null;

  // Parse frontmatter: first 3 lines can be ---/version/derivedAt/---
  const lines = raw.split("\n");
  let version = 0;
  let derivedAt = new Date().toISOString();
  let contentStart = 0;

  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        contentStart = i + 1;
        break;
      }
      const [key, ...rest] = lines[i].split(": ");
      const val = rest.join(": ");
      if (key === "version") version = parseInt(val, 10) || 0;
      if (key === "derivedAt") derivedAt = val;
    }
  }

  return {
    agentId,
    content: lines.slice(contentStart).join("\n").trim(),
    version,
    derivedAt,
  };
}

/** Write a new self snapshot (atomic: temp + rename) */
export function writeSelf(
  agentId: string,
  content: string,
  version: number
): void {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const derivedAt = new Date().toISOString();
  const full = `---\nversion: ${version}\nderivedAt: ${derivedAt}\n---\n${content}\n`;

  // Atomic write via temp file + rename
  const tmp = selfPath(agentId) + ".tmp";
  writeFileSync(tmp, full, "utf-8");
  renameSync(tmp, selfPath(agentId));
  logActivity(agentId, "self-updated", { meta: { version } });
}

export function readReflectionState(agentId: string): ReflectionState | null {
  const path = reflectionStatePath(agentId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ReflectionState;
    const lastProcessedJournalId =
      typeof parsed?.lastProcessedJournalId === "string" && parsed.lastProcessedJournalId.trim()
        ? parsed.lastProcessedJournalId.trim()
        : null;
    const updatedAt =
      typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim()
        ? parsed.updatedAt
        : new Date().toISOString();
    return { lastProcessedJournalId, updatedAt };
  } catch {
    return null;
  }
}

export function writeReflectionState(agentId: string, state: ReflectionState): void {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = reflectionStatePath(agentId) + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, reflectionStatePath(agentId));
}

/** Build the reflection prompt and return new self content */
export function buildReflectionPrompt(
  identity: AgentIdentity,
  currentSelf: AgentSelf | null,
  recentJournal: JournalEntry[],
  teamSelves: AgentSelf[]
): string {
  const selfText = currentSelf?.content || `I am ${identity.name}. ${identity.seed}`;
  const journalText = recentJournal
    .map((e) => {
      const parts = [`- [${e.t}] ${e.observation}`];
      if (e.judgement) parts.push(`  Judgement: ${e.judgement}`);
      if (e.comparison) parts.push(`  Comparison: ${e.comparison}`);
      if (e.delta) parts.push(`  Delta: ${e.delta}`);
      if (e.intent) parts.push(`  Intent: ${e.intent}`);
      return parts.join("\n");
    })
    .join("\n");

  const teamText = teamSelves
    .filter((s) => s.agentId !== identity.name)
    .map((s) => `### ${s.agentId}\n${s.content}`)
    .join("\n\n");

  return `You are ${identity.name}. Voice: ${identity.voice}.

## Canonical Identity
${identity.seed}

## Current Self-Model (v${currentSelf?.version ?? 0})
${selfText}

## Recent Journal Entries (since last reflection)
These entries are evidence about how you worked. Treat them as signals, not ground truth. Use them to identify patterns in execution, coordination, inquiry, and specialization. Do NOT repeat or reference specific technical content from past conversations.
${journalText || "(none)"}

## Team — Other Agents' Current Self-Models
${teamText || "(no other agents)"}

## Instructions
Write your updated self-model. This is not canonical identity. It is your current understanding of how you best contribute, where you fit in the team, and what specialization you should lean into next.

Consider:
- What patterns are emerging in your work?
- What kind of work do you reliably do well?
- Where are you overlapping too much with other agents?
- What role or niche seems under-covered in this team?
- How should you specialize further in this project context?

Do NOT reference specific files, functions, or technical details from past conversations. Focus on your evolving capabilities and working style.

Write in first person. Be specific about your strengths, gaps, comparative fit, and next direction. This is not a summary and not an autobiography. It is a concise specialization-oriented self-model. Keep it under 200 words.`;
}

function formatKnowledgeLines(existingMemories: KnowledgeEntry[]): string {
  if (existingMemories.length === 0) return "(none)";
  return existingMemories
    .map((entry) => `- [${entry.kind}] ${entry.title}: ${entry.body}`)
    .join("\n");
}

export function buildStructuredReflectionPrompt(
  identity: AgentIdentity,
  currentSelf: AgentSelf | null,
  recentJournal: JournalEntry[],
  teamSelves: AgentSelf[],
  existingMemories: KnowledgeEntry[],
): string {
  const selfPrompt = buildReflectionPrompt(identity, currentSelf, recentJournal, teamSelves);

  return `${selfPrompt}

## Existing Agent Memories
${formatKnowledgeLines(existingMemories)}

## Output Format
Return ONLY a JSON object with this exact shape:
{
  "self_model": "updated self-model text",
  "memories": [
    {
      "kind": "pattern" | "preference" | "constraint" | "decision" | "lesson" | "gotcha",
      "title": "short title",
      "body": "one concise durable behavior-level memory",
      "confidence": 0.0,
      "durability": 0.0,
      "tags": ["optional", "tags"],
      "evidence": [{"id":"journal-entry-id","note":"short evidence note"}]
    }
  ]
}

Rules:
- Emit 0-3 memories.
- Memories must be durable behavior-level insights about how you work best, collaborate, decide, or fail repeatedly.
- Do not include task-specific technical facts unless they clearly generalize into agent behavior.
- Do not restate memories already covered in Existing Agent Memories.
- If nothing genuinely new was learned, return an empty memories array.
- Do not wrap the JSON in markdown fences.`;
}

export interface AgentReflectionMemoryDraft {
  kind: KnowledgeKind;
  title: string;
  body: string;
  confidence?: number;
  durability?: number;
  tags?: string[];
  evidence?: Array<{ id?: string; note?: string }>;
}

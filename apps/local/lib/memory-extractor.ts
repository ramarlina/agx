import { createHash, randomUUID } from "crypto";
import { runCliResponse } from "./cli-runner";
import { getSQLiteDb } from "./sqlite-query-adapter";
import { storeKnowledgeEntries } from "./knowledge-store";
import { getKnowledgeNote, upsertKnowledgeNote } from "./knowledge-notes";

export interface ExtractedMemory {
  memory_type: "outcome" | "decision" | "pattern" | "gotcha";
  content: string;
}

interface TaskContext {
  goal: string;
  status: string;
  nodeOutputs?: Record<string, unknown>;
}

export interface ExtractedProjectKnowledge {
  updated_note: string;
  change_summary?: string;
  no_change?: boolean;
}

interface ResolveMemoryAgentIdInput {
  explicitAgentId?: string | null;
  defaultUserId?: string | null;
  frontmatter?: Record<string, unknown> | null;
}

const VALID_TYPES = new Set(["outcome", "decision", "pattern", "gotcha"]);

const EXTRACTION_PROMPT = `You are a memory extractor for a task execution system.
Given a completed task, extract 0-3 memories worth remembering for future tasks.

Each memory must be:
{ "memory_type": "outcome" | "decision" | "pattern" | "gotcha", "content": "one concise sentence" }

- outcome: what happened (success/failure result)
- decision: a choice that was made and why
- pattern: a reusable approach or technique discovered
- gotcha: a surprising pitfall or edge case encountered

Return ONLY a JSON array. Return [] if nothing worth remembering.
Do not wrap in markdown code blocks. Just raw JSON.`;

const PROJECT_KNOWLEDGE_PROMPT = `You are maintaining a living project knowledge note for a task execution system.
Given the current project note and a completed or failed task, decide whether the note should change.

Return ONLY a JSON object:
{
  "updated_note": "full revised note in concise markdown",
  "change_summary": "short summary of what changed",
  "no_change": false
}

Rules:
- Revise the current note instead of appending isolated bullets.
- Write like a person's living project notes, not an extracted fact list.
- The note should help someone understand what the project is, what it does, what has been decided, and what lessons now shape future work.
- Prefer short sections and narrative paragraphs in markdown. Bullets are fine only when they genuinely improve clarity.
- Preserve strong existing content when still valid.
- Merge duplicate ideas, sharpen wording, and remove stale or unsupported claims.
- Only include project-scoped knowledge likely useful across future work in the same project.
- Do not include repo-specific durable truths that belong in repo knowledge.
- Avoid generic filler and avoid sounding like an audit log.
- If nothing project-scoped changed, return {"no_change": true}.
- Do not wrap in markdown code blocks. Just raw JSON.`;

export async function extractMemories(ctx: TaskContext): Promise<ExtractedMemory[]> {
  const taskDescription = [
    `Goal: ${ctx.goal}`,
    `Status: ${ctx.status}`,
    ctx.nodeOutputs
      ? `Node outputs: ${JSON.stringify(ctx.nodeOutputs).slice(0, 2000)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `${EXTRACTION_PROMPT}\n\nTask:\n${taskDescription}`;

  let raw = "";
  try {
    await runCliResponse({
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
      prompt,
      onDelta: (chunk) => {
        raw += chunk;
      },
    });
  } catch (err) {
    console.warn("[memory-extractor] LLM call failed:", err);
    return [];
  }

  return parseMemoryResponse(raw);
}

function parseMemoryResponse(raw: string): ExtractedMemory[] {
  const trimmed = raw.trim();
  // Strip markdown code fences if present
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m: unknown): m is ExtractedMemory =>
          typeof m === "object" &&
          m !== null &&
          VALID_TYPES.has((m as any).memory_type) &&
          typeof (m as any).content === "string" &&
          (m as any).content.trim().length > 0,
      )
      .slice(0, 3);
  } catch {
    console.warn("[memory-extractor] Failed to parse LLM response:", cleaned.slice(0, 200));
    return [];
  }
}

function parseProjectKnowledgeResponse(raw: string): ExtractedProjectKnowledge[] {
  const trimmed = raw.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const updatedNote =
      typeof (parsed as any).updated_note === "string"
        ? (parsed as any).updated_note.trim()
        : "";
    const noChange = Boolean((parsed as any).no_change);
    if (noChange) return [];
    if (!updatedNote) return [];
    return [{
      updated_note: updatedNote,
      change_summary:
        typeof (parsed as any).change_summary === "string"
          ? (parsed as any).change_summary.trim()
          : undefined,
      no_change: false,
    }];
  } catch {
    console.warn("[project-knowledge] Failed to parse LLM response:", cleaned.slice(0, 200));
    return [];
  }
}

const VALID_TYPES_SET = new Set(["outcome", "decision", "pattern", "gotcha"]);
const MEMORY_AGENT_KEYS = [
  "agent_id",
  "agentId",
  "agent",
  "participant_id",
  "participantId",
  "assigned_agent",
  "assignedAgent",
];

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve which logical agent owns the memory.
 * Falls back to user ID only when no explicit/embedded agent identifier exists.
 */
export function resolveMemoryAgentId(input: ResolveMemoryAgentIdInput): string {
  const explicit = asNonEmptyString(input.explicitAgentId);
  if (explicit) return explicit;

  const frontmatter = input.frontmatter || {};
  for (const key of MEMORY_AGENT_KEYS) {
    const resolved = asNonEmptyString(frontmatter[key]);
    if (resolved) return resolved;
  }

  return asNonEmptyString(input.defaultUserId) || "system";
}

export async function storeMemories(
  taskId: string,
  agentId: string,
  memories: ExtractedMemory[],
): Promise<number> {
  const db = getSQLiteDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO agent_memory (id, agent_id, task_id, memory_type, content, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let inserted = 0;
  const now = Date.now();

  for (const mem of memories) {
    if (!VALID_TYPES_SET.has(mem.memory_type) || !mem.content?.trim()) continue;
    const contentHash = createHash("sha256").update(mem.content.trim()).digest("hex");
    const result = stmt.run(randomUUID(), agentId, taskId, mem.memory_type, mem.content.trim(), contentHash, now);
    if (result.changes > 0) inserted++;
  }

  if (inserted > 0) {
    storeKnowledgeEntries(
      memories.map((mem) => ({
        scope: "agent",
        subjectId: agentId,
        sourceType: "task_completion",
        sourceId: taskId,
        kind: mem.memory_type,
        title: mem.content.trim().slice(0, 80),
        body: mem.content.trim(),
        confidence: 0.7,
        durability: 0.6,
        metadata: { task_id: taskId },
      }))
    );
  }

  return inserted;
}

export async function extractAndStoreMemories(
  taskId: string,
  agentId: string,
  ctx: TaskContext,
): Promise<void> {
  const memories = await extractMemories(ctx);
  if (memories.length === 0) return;

  const inserted = await storeMemories(taskId, agentId, memories);
  if (inserted > 0) {
    console.log(`[memory-extractor] Stored ${inserted} memories for task ${taskId}`);
  }
}

async function resolveProjectId(projectIdOrSlug?: string | null): Promise<string | null> {
  const explicit = asNonEmptyString(projectIdOrSlug);
  if (!explicit) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicit)) {
    return explicit;
  }
  const db = getSQLiteDb();
  const project = db
    .prepare("SELECT id FROM projects WHERE slug = ? LIMIT 1")
    .get(explicit) as { id: string } | undefined;
  return project?.id ?? null;
}

export async function extractProjectKnowledge(
  ctx: TaskContext,
  currentNote: string,
): Promise<ExtractedProjectKnowledge[]> {
  const taskDescription = [
    `Goal: ${ctx.goal}`,
    `Status: ${ctx.status}`,
    ctx.nodeOutputs
      ? `Node outputs: ${JSON.stringify(ctx.nodeOutputs).slice(0, 2000)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `${PROJECT_KNOWLEDGE_PROMPT}\n\nCurrent note:\n${currentNote || "(empty)"}\n\nTask:\n${taskDescription}`;

  let raw = "";
  try {
    await runCliResponse({
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
      prompt,
      onDelta: (chunk) => {
        raw += chunk;
      },
    });
  } catch (err) {
    console.warn("[project-knowledge] LLM call failed:", err);
    return [];
  }

  return parseProjectKnowledgeResponse(raw);
}

export async function storeProjectKnowledge(
  projectId: string,
  taskId: string,
  entries: ExtractedProjectKnowledge[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const entry = entries[0];
  if (!entry || !entry.updated_note?.trim()) return 0;
  const result = upsertKnowledgeNote({
    scope: "project",
    subjectId: projectId,
    content: entry.updated_note.trim(),
    changeSummary: entry.change_summary,
    sourceType: "task_completion",
    sourceId: taskId,
    metadata: { task_id: taskId },
  });
  return result.changed ? 1 : 0;
}

export async function extractAndStoreProjectKnowledge(
  taskId: string,
  projectIdOrSlug: string | null | undefined,
  ctx: TaskContext,
): Promise<void> {
  const projectId = await resolveProjectId(projectIdOrSlug);
  if (!projectId) return;

  const knowledge = await extractProjectKnowledge(ctx, getKnowledgeNote("project", projectId)?.content ?? "");
  if (knowledge.length === 0) return;

  const inserted = await storeProjectKnowledge(projectId, taskId, knowledge);
  if (inserted > 0) {
    console.log(`[project-knowledge] Stored ${inserted} project knowledge entries for task ${taskId}`);
  }
}

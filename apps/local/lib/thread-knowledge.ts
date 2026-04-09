import { getProjectForThread, getProjectWithRepos } from "./db";
import { loadHistory } from "./history-store";
import { runCliResponse } from "./cli-runner";
import { getKnowledgeNote, upsertKnowledgeNote } from "./knowledge-notes";
import type { ThreadKnowledgeScope } from "./thread-knowledge-runs";
import type { GroupMessage } from "./types";

interface ThreadTransitionInput {
  threadId: string;
  rootMessageId: string;
  fromStatus: string;
  toStatus: string;
  outcomeNote?: string | null;
}

interface ThreadKnowledgeRunInput extends ThreadTransitionInput {
  trigger: "status_transition" | "manual";
  scopes: ThreadKnowledgeScope[];
}

interface ParsedRepoNoteRevision {
  subject_id?: string;
  updated_note?: string;
  change_summary?: string;
  no_change?: boolean;
}

interface ParsedProjectNoteRevision {
  updated_note?: string;
  change_summary?: string;
  no_change?: boolean;
}

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3)}...`;
}

function formatMessages(messages: GroupMessage[]): string {
  return messages
    .map((message) => {
      const speaker = message.role === "user"
        ? "User"
        : (message.participantId?.trim() || "Assistant");
      return `[${message.id}] ${speaker}: ${truncate(message.content, 800)}`;
    })
    .join("\n\n");
}

function extractSummary(messages: GroupMessage[]): string | null {
  const summary = [...messages]
    .reverse()
    .find((message) => message.content.startsWith("<!-- thread-summary -->"));
  if (!summary) return null;
  return summary.content.replace("<!-- thread-summary -->", "").trim() || null;
}

function formatExistingNote(content: string | null | undefined): string {
  const trimmed = String(content ?? "").trim();
  return trimmed || "(empty)";
}

function parseRepoNoteRevisions(raw: string): ParsedRepoNoteRevision[] {
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    return Array.isArray(parsed) ? (parsed as ParsedRepoNoteRevision[]) : [];
  } catch {
    return [];
  }
}

function parseProjectNoteRevision(raw: string): ParsedProjectNoteRevision | null {
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ParsedProjectNoteRevision)
      : null;
  } catch {
    return null;
  }
}

async function runRawPrompt(prompt: string): Promise<string> {
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
  } catch (error) {
    console.warn("[thread-knowledge] LLM call failed:", error);
    return "";
  }
  return raw;
}

function buildRepoPrompt(input: {
  trigger: "status_transition" | "manual";
  projectName: string;
  fromStatus: string;
  toStatus: string;
  outcomeNote?: string | null;
  summary: string | null;
  repos: Array<{ id: string; name: string; path: string | null }>;
  messages: GroupMessage[];
  existingNotesByRepo: Map<string, string>;
}): string {
  const repoLines = input.repos
    .map((repo) => `- ${repo.id}: ${repo.name}${repo.path ? ` (${repo.path})` : ""}`)
    .join("\n");
  const noteLines = input.repos
    .map((repo) => {
      const existing = input.existingNotesByRepo.get(repo.id) ?? "";
      return `## ${repo.id} ${repo.name}\n${formatExistingNote(existing)}`;
    })
    .join("\n\n");

  const triggerLine = input.trigger === "manual"
    ? "Trigger: manual rerun from the thread UI"
    : `Transition: ${input.fromStatus} -> ${input.toStatus}`;

  return `You are maintaining living repo knowledge notes from a thread review.

Project: ${input.projectName}
${triggerLine}
Outcome note: ${input.outcomeNote?.trim() || "(none)"}

Repos in scope:
${repoLines}

Thread summary:
${input.summary || "(none)"}

Thread messages:
${truncate(formatMessages(input.messages), 12000)}

Current repo knowledge notes:
${noteLines || "(none)"}

Return ONLY a JSON array. Each item must be:
{
  "subject_id": "one repo id from the list above",
  "updated_note": "the full revised note for that repo in concise markdown",
  "change_summary": "short summary of what changed",
  "no_change": false
}

Rules:
- Return 0-3 items total, and omit repos whose notes should not change.
- Revise the current note instead of appending generic filler.
- Write like a person's working repo note, not an extracted fact list.
- The note should help someone quickly understand what this repo is, what it does, how it is shaped, and what matters when working in it.
- Prefer short sections and narrative paragraphs in markdown. Bullets are fine only when they genuinely improve clarity.
- Preserve sharp existing content when still valid.
- Merge duplicates, sharpen vague wording, and remove stale or unsupported claims if the thread proves they are wrong.
- Only include settled, reusable knowledge about architecture, constraints, conventions, integration behavior, or failure modes.
- Ignore proposals, unresolved debate, task management chatter, and one-off debugging noise.
- Avoid sounding like a report or audit log. This should read like living internal notes from someone who knows the codebase.
- If nothing genuinely new was learned for a repo, do not include that repo in the array.
- Do not wrap in markdown fences.`;
}

function buildProjectPrompt(input: {
  trigger: "status_transition" | "manual";
  projectId: string;
  projectName: string;
  fromStatus: string;
  toStatus: string;
  outcomeNote?: string | null;
  summary: string | null;
  messages: GroupMessage[];
  currentNote: string;
}): string {
  const triggerLine = input.trigger === "manual"
    ? "Trigger: manual rerun from the thread UI"
    : `Transition: ${input.fromStatus} -> ${input.toStatus}`;

  return `You are maintaining a living project knowledge note from a thread review.

Project: ${input.projectName} (${input.projectId})
${triggerLine}
Outcome note: ${input.outcomeNote?.trim() || "(none)"}

Thread summary:
${input.summary || "(none)"}

Thread messages:
${truncate(formatMessages(input.messages), 12000)}

Current project knowledge note:
${formatExistingNote(input.currentNote)}

Return ONLY a JSON object with this shape:
{
  "updated_note": "the full revised project note in concise markdown",
  "change_summary": "short summary of what changed",
  "no_change": false
}

Rules:
- Revise the existing note instead of outputting isolated bullets.
- Write like a person's running project notes, not an extracted fact list.
- The note should explain what the project is, what it is trying to do, how it currently works, and the most important decisions or lessons shaping it.
- Prefer short sections and narrative paragraphs in markdown. Bullets are fine only when they genuinely improve clarity.
- Preserve strong existing content when it still holds.
- Merge duplicate ideas and remove stale or unsupported claims.
- Focus on decisions made, tradeoffs accepted, goals clarified, completed outcomes, and lessons learned.
- Prefer outcome-level knowledge over implementation detail.
- Avoid generic filler and avoid sounding like a generated summary.
- If nothing genuinely new was learned, return {"no_change": true}.
- Do not wrap in markdown fences.`;
}

async function extractRepoKnowledge(input: {
  trigger: "status_transition" | "manual";
  projectName: string;
  transition: ThreadTransitionInput;
  repos: Array<{ id: string; name: string; path: string | null }>;
  messages: GroupMessage[];
}): Promise<number> {
  if (input.repos.length === 0) return 0;

  const existingNotesByRepo = new Map<string, string>();
  for (const repo of input.repos) {
    existingNotesByRepo.set(repo.id, getKnowledgeNote("repo", repo.id)?.content ?? "");
  }

  const prompt = buildRepoPrompt({
    trigger: input.trigger,
    projectName: input.projectName,
    fromStatus: input.transition.fromStatus,
    toStatus: input.transition.toStatus,
    outcomeNote: input.transition.outcomeNote,
    summary: extractSummary(input.messages),
    repos: input.repos,
    messages: input.messages,
    existingNotesByRepo,
  });

  const revisions = parseRepoNoteRevisions(await runRawPrompt(prompt));
  let changed = 0;
  for (const item of revisions.slice(0, 3)) {
    const repoId = typeof item.subject_id === "string" ? item.subject_id.trim() : "";
    const updatedNote = typeof item.updated_note === "string" ? item.updated_note.trim() : "";
    if (!repoId || !input.repos.some((repo) => repo.id === repoId) || !updatedNote || item.no_change) continue;
    const result = upsertKnowledgeNote({
      scope: "repo",
      subjectId: repoId,
      content: updatedNote,
      changeSummary: item.change_summary,
      sourceType: "thread_transition",
      sourceId: input.transition.rootMessageId,
      metadata: {
        thread_id: input.transition.threadId,
        root_message_id: input.transition.rootMessageId,
        status_from: input.transition.fromStatus,
        status_to: input.transition.toStatus,
      },
    });
    if (result.changed) changed += 1;
  }

  return changed;
}

async function extractProjectKnowledge(input: {
  trigger: "status_transition" | "manual";
  projectId: string;
  projectName: string;
  transition: ThreadTransitionInput;
  messages: GroupMessage[];
}): Promise<number> {
  const currentNote = getKnowledgeNote("project", input.projectId)?.content ?? "";

  const prompt = buildProjectPrompt({
    trigger: input.trigger,
    projectId: input.projectId,
    projectName: input.projectName,
    fromStatus: input.transition.fromStatus,
    toStatus: input.transition.toStatus,
    outcomeNote: input.transition.outcomeNote,
    summary: extractSummary(input.messages),
    messages: input.messages,
    currentNote,
  });

  const revision = parseProjectNoteRevision(await runRawPrompt(prompt));
  if (!revision || revision.no_change) {
    return 0;
  }
  const updatedNote = typeof revision.updated_note === "string" ? revision.updated_note.trim() : "";
  if (!updatedNote) {
    return 0;
  }
  const result = upsertKnowledgeNote({
    scope: "project",
    subjectId: input.projectId,
    content: updatedNote,
    changeSummary: revision.change_summary,
    sourceType: "thread_transition",
    sourceId: input.transition.rootMessageId,
    metadata: {
      thread_id: input.transition.threadId,
      root_message_id: input.transition.rootMessageId,
      status_from: input.transition.fromStatus,
      status_to: input.transition.toStatus,
    },
  });
  return result.changed ? 1 : 0;
}

async function runThreadKnowledgeExtraction(input: ThreadKnowledgeRunInput): Promise<{
  repoInsertedCount: number;
  projectInsertedCount: number;
}> {
  const projectId = await getProjectForThread(input.threadId);
  if (!projectId) {
    return { repoInsertedCount: 0, projectInsertedCount: 0 };
  }

  const project = await getProjectWithRepos(projectId);
  if (!project) {
    return { repoInsertedCount: 0, projectInsertedCount: 0 };
  }

  const history = await loadHistory(input.threadId);
  const root = history.find((message) => message.id === input.rootMessageId);
  if (!root) {
    return { repoInsertedCount: 0, projectInsertedCount: 0 };
  }
  const replies = history.filter((message) => message.rootMessageId === input.rootMessageId);
  const messages = [root, ...replies];
  let repoInsertedCount = 0;
  let projectInsertedCount = 0;

  if (input.scopes.includes("repo")) {
    repoInsertedCount = await extractRepoKnowledge({
      trigger: input.trigger,
      projectName: project.name,
      transition: input,
      repos: (project.repos ?? []).map((repo) => ({
        id: repo.id,
        name: repo.name,
        path: repo.path ?? null,
      })),
      messages,
    });
  }

  if (input.scopes.includes("project")) {
    projectInsertedCount = await extractProjectKnowledge({
      trigger: input.trigger,
      projectId: project.id,
      projectName: project.name,
      transition: input,
      messages,
    });
  }

  return { repoInsertedCount, projectInsertedCount };
}

export async function extractKnowledgeFromThreadTransition(input: ThreadTransitionInput): Promise<void> {
  const scopes: ThreadKnowledgeScope[] = [];
  if (input.fromStatus === "active" && (input.toStatus === "in-review" || input.toStatus === "done")) {
    scopes.push("repo");
  }
  if (input.toStatus === "done") {
    scopes.push("project");
  }
  if (scopes.length === 0) return;

  await runThreadKnowledgeExtraction({
    ...input,
    trigger: "status_transition",
    scopes,
  });
}

export async function extractKnowledgeFromThread(input: {
  threadId: string;
  rootMessageId: string;
  status: string;
  outcomeNote?: string | null;
  scopes: ThreadKnowledgeScope[];
}): Promise<{ repoInsertedCount: number; projectInsertedCount: number }> {
  if (input.scopes.length === 0) {
    return { repoInsertedCount: 0, projectInsertedCount: 0 };
  }
  return runThreadKnowledgeExtraction({
    threadId: input.threadId,
    rootMessageId: input.rootMessageId,
    fromStatus: input.status,
    toStatus: input.status,
    outcomeNote: input.outcomeNote,
    trigger: "manual",
    scopes: Array.from(new Set(input.scopes)),
  });
}

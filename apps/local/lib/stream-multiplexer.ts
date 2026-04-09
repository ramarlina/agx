import { readFile } from "fs/promises";
import type { Participant, ChatEvent } from "./types";
import { runCliResponse } from "./cli-runner";
import { register, update as updateProcess } from "./agent-process-registry";
import { saveMessages, setReaction, saveLogs } from "./history-store";
import { parseReactionSignals } from "./reaction-protocol";
import { getAttachmentMeta } from "./attachment-store";
import { getSQLiteDb } from "./sqlite-query-adapter";
import {
  readSelf,
  writeSelf,
  readReflectionState,
  writeReflectionState,
  buildStructuredReflectionPrompt,
  type AgentReflectionMemoryDraft,
} from "./mesh-core/self";
import { readJournal, readJournalSince, appendJournal } from "./mesh-core/journal";
import { readIdentity, getTeamSelves, listAgents, ensureAgent } from "./mesh-core/agent";
import { appendReaction } from "./mesh-core/reactions";
import { logActivity } from "./mesh-core/activity";
import type { MeshReactionType } from "./mesh-core/types";
import { listKnowledgeEntries, storeKnowledgeEntries, type KnowledgeEvidence } from "./knowledge-store";
import { resolveBoundSkillFiles } from "./agent-skill-bindings";
import { randomUUID, createHash } from "crypto";

/** Per-agent message counter for reflection cadence */
const agentMessageCounts = new Map<string, number>();
const reflectionQueues = new Map<string, Promise<void>>();
const REFLECTION_CADENCE = 10;

function isKnowledgeEvidence(
  value: KnowledgeEvidence | null,
): value is KnowledgeEvidence {
  return value !== null;
}

const DEFAULT_RUNTIME_SEED = "I evolve through experience and collaboration.";

function normalizeRuntimeSeedText(raw: string, name: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return `I am ${name}. ${DEFAULT_RUNTIME_SEED}`;

  const withoutSecondPersonLead = collapsed.replace(
    /^you are\b[^.!?\n]*[.!?]?\s*/i,
    `I am ${name}. `,
  );
  const normalized = /^i am\b/i.test(withoutSecondPersonLead)
    ? withoutSecondPersonLead
    : `I am ${name}. ${withoutSecondPersonLead}`;

  return normalized.slice(0, 500).trim();
}

export function seedFromIdentityText(
  identity: string | undefined,
  name: string,
  explicitSeed?: string,
): string {
  const preferredSeed = String(explicitSeed || "").trim();
  if (preferredSeed) {
    return normalizeRuntimeSeedText(preferredSeed, name);
  }

  const raw = String(identity || "").trim();
  if (!raw) return `I am ${name}. ${DEFAULT_RUNTIME_SEED}`;
  return normalizeRuntimeSeedText(raw, name);
}

export function buildParticipantIdentity(p: Participant, identityOverride?: string): string | undefined {
  const parts = [
    String(identityOverride ?? p.identity ?? "").trim(),
    p.voice?.trim() ? `Voice: ${p.voice.trim()}` : "",
    p.seed?.trim() ? `Core orientation: ${p.seed.trim()}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function derivePerMessageJournalInsights(
  response: string
): { judgement: string; delta: string; intent?: string } {
  const text = response.trim();
  const preview = text.slice(0, 120).replace(/\n/g, " ");

  const hasQuestion = /\?/.test(text);
  const mentions = text.match(/@\w+/g) || [];
  const hasAction =
    /\b(should|need to|must|plan|steps?|implement|fix|verify|ship|next|start)\b/i.test(text);
  const hasUncertainty = /\b(maybe|might|could|unsure|not sure|unclear)\b/i.test(text);
  const hasCommitment = /\b(i will|i'll|i can|i'm going to|starting|checking|verified|fixed|done|shipped)\b/i.test(text);
  const hasCode = /```/.test(text) || /\bfunction\b|\bconst\b|\binterface\b/i.test(text);
  const hasSpec = /\|.*\|.*\|/.test(text) || /^#{1,3}\s/m.test(text);
  const hasReview = /\b(finding|issue|bug|problem|missing|broken|wrong)\b/i.test(text);

  // Keep this close to observation. Journal entries are evidence, not a
  // canonical personality rewrite.
  let judgement: string;
  if (hasCode && hasSpec) {
    judgement = `Observed a structured technical response with code or implementation detail — "${preview}..."`;
  } else if (hasCode) {
    judgement = `Observed code-centric output — "${preview}..."`;
  } else if (hasSpec) {
    judgement = `Observed structured analysis or specification language — "${preview}..."`;
  } else if (hasReview) {
    judgement = `Observed review or issue-spotting behavior — "${preview}..."`;
  } else if (hasCommitment) {
    judgement = `Observed a concrete commitment to action — "${preview}..."`;
  } else if (hasAction) {
    judgement = `Observed direction-setting or next-step guidance — "${preview}..."`;
  } else if (hasQuestion) {
    judgement = `Observed clarifying or exploratory questioning — "${preview}..."`;
  } else if (hasUncertainty) {
    judgement = `Observed explicit uncertainty or caveating — "${preview}..."`;
  } else if (mentions.length > 0) {
    judgement = `Observed coordination with ${mentions.join(", ")} — "${preview}..."`;
  } else {
    judgement = `Observed a general perspective contribution — "${preview}..."`;
  }

  // Build delta from the combination of signals
  const signals: string[] = [];
  if (hasCode || hasSpec) signals.push("technical depth");
  if (hasAction || hasCommitment) signals.push("execution bias");
  if (hasQuestion) signals.push("inquiry instinct");
  if (hasReview) signals.push("critical eye");
  if (mentions.length > 0) signals.push("team coordination");
  if (hasUncertainty) signals.push("intellectual honesty");

  let delta: string;
  if (signals.length > 0) {
    delta = `Candidate specialization signals: ${signals.join(" + ")}. Treat as suggestive evidence, not settled identity.`;
  } else {
    delta = `Low-signal contribution for specialization; keep as weak evidence only.`;
  }

  let intent: string | undefined;
  if (hasAction || hasCommitment) {
    intent = "Follow through on the action I just committed to.";
  } else if (hasReview) {
    intent = "Verify the issues I flagged get addressed.";
  } else if (hasQuestion) {
    intent = "Wait for the answer before moving forward.";
  }

  return { judgement, delta, intent };
}

function ensureAgentArtifacts(p: Participant, identityText?: string): void {
  ensureAgent(p.id, {
    voice: p.voice?.trim() || `${p.name} style`,
    seed: seedFromIdentityText(identityText, p.name, p.seed),
  });
}

function enqueueReflection(p: Participant): Promise<void> {
  const previous = reflectionQueues.get(p.id) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      // keep queue alive on prior failure
    })
    .then(() => runReflection(p));
  reflectionQueues.set(p.id, next);
  return next.finally(() => {
    if (reflectionQueues.get(p.id) === next) {
      reflectionQueues.delete(p.id);
    }
  });
}

/** Run reflection: derive a specialization-oriented self-model from evidence */
async function runReflection(p: Participant): Promise<void> {
  ensureAgentArtifacts(p);
  const identity = readIdentity(p.id);
  if (!identity) return;

  const currentSelf = readSelf(p.id);
  const reflectionState = readReflectionState(p.id);
  const recentEntries = readJournalSince(p.id, reflectionState?.lastProcessedJournalId)
    .filter((entry) => entry.type === "post");
  if (recentEntries.length === 0) return;
  const teamSelves = getTeamSelves(p.id);
  const newVersion = (currentSelf?.version ?? 0) + 1;
  const existingMemories = listKnowledgeEntries({ scope: "agent", subjectId: p.id, limit: 50 });
  const reflectionPrompt = buildStructuredReflectionPrompt(
    identity,
    currentSelf,
    recentEntries,
    teamSelves,
    existingMemories,
  );

  let reflectionRaw = "";
  await runCliResponse({
    provider: p.provider,
    model: p.model,
    systemContext: `You are performing a self-modeling exercise. Output ONLY raw JSON matching the requested schema. No markdown fences, no commentary.`,
    prompt: reflectionPrompt,
    signal: undefined,
    onDelta: (chunk) => { reflectionRaw += chunk; },
  });

  const cleaned = reflectionRaw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  let parsed: { self_model?: string; memories?: AgentReflectionMemoryDraft[] } | null = null;
  try {
    parsed = JSON.parse(cleaned) as { self_model?: string; memories?: AgentReflectionMemoryDraft[] };
  } catch {
    parsed = null;
  }

  const newSelfContent = parsed?.self_model?.trim() || "";
  if (!newSelfContent) return;

  const memoryDrafts = Array.isArray(parsed?.memories)
    ? parsed!.memories
        .slice(0, 3)
        .map((memory) => ({
          scope: "agent" as const,
          subjectId: p.id,
          sourceType: "reflection" as const,
          sourceId: recentEntries[recentEntries.length - 1]?.id || `reflection:${p.id}:${newVersion}`,
          kind: memory.kind,
          title: String(memory.title ?? "").trim(),
          body: String(memory.body ?? "").trim(),
          confidence: memory.confidence,
          durability: memory.durability,
          tags: memory.tags,
          evidence: Array.isArray(memory.evidence)
            ? memory.evidence
                .map((item) => {
                  const note = String(item?.note ?? "").trim();
                  const id = typeof item?.id === "string" ? item.id.trim() : "";
                  return note ? (id ? { id, note } : { note }) : null;
                })
                .filter(isKnowledgeEvidence)
            : [],
          metadata: {
            reflection_window_start: recentEntries[0]?.id ?? null,
            reflection_window_end: recentEntries[recentEntries.length - 1]?.id ?? null,
            self_version: newVersion,
          },
        }))
        .filter((memory) => memory.title && memory.body)
    : [];

  const insertedKnowledge = storeKnowledgeEntries(memoryDrafts);
  writeSelf(p.id, newSelfContent, newVersion);
  writeReflectionState(p.id, {
    lastProcessedJournalId: recentEntries[recentEntries.length - 1]?.id ?? reflectionState?.lastProcessedJournalId ?? null,
    updatedAt: new Date().toISOString(),
  });

  if (insertedKnowledge > 0) {
    const db = getSQLiteDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO agent_memory (id, agent_id, task_id, memory_type, content, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const reflectionTaskId = `reflection:${p.id}:${recentEntries[recentEntries.length - 1]?.id ?? newVersion}`;
    const now = Date.now();
    for (const memory of memoryDrafts) {
      const memoryType =
        memory.kind === "decision"
          ? "decision"
          : memory.kind === "gotcha" || memory.kind === "constraint"
            ? "gotcha"
            : memory.kind === "outcome"
              ? "outcome"
              : "pattern";
      const contentHash = createHash("sha256").update(memory.body.trim()).digest("hex");
      stmt.run(randomUUID(), p.id, reflectionTaskId, memoryType, memory.body.trim(), contentHash, now);
    }
  }

  // Append reflection journal entry
  appendJournal(p.id, {
    t: new Date().toISOString(),
    type: "reflection",
    observation: `Reflected after ${REFLECTION_CADENCE} messages`,
    judgement: "Updated self-model from incremental journal evidence and deduped agent memories",
    delta: `self-model updated to v${newVersion}${insertedKnowledge > 0 ? `; stored ${insertedKnowledge} agent memories` : ""}`,
    threads: [],
    selfVersion: newVersion,
    body: newSelfContent,
  });

  // Cross-agent reactions: react to other agents' recent journal entries
  // Ask the LLM which entries resonate, then emit reactions
  const otherAgents = listAgents().filter((id) => id !== p.id);
  const otherEntries = otherAgents.flatMap((id) =>
    readJournal(id, 3).map((e) => ({ agentId: id, entry: e }))
  );

  if (otherEntries.length > 0) {
    const entrySummaries = otherEntries
      .map((o) => `${o.entry.id}: ${o.entry.observation.slice(0, 200)}`)
      .join("\n");

    let reactionsRaw = "";
    try {
      await runCliResponse({
        provider: p.provider,
        model: p.model,
        prompt: `You are ${p.id}. Review these recent entries from other agents and react to any that resonate with you.\n\nEntries:\n${entrySummaries}\n\nFor each entry you want to react to, output one line in this exact format:\nREACT <entryId> <type>\n\nValid types: agree, disagree, learned-from, builds-on, curious\n\nOnly react to entries that genuinely resonate. It's fine to react to zero entries. Output nothing else.`,
        signal: undefined,
        onDelta: (chunk) => { reactionsRaw += chunk; },
      });
    } catch {
      // best-effort
    }

    // Parse and apply reactions
    for (const line of reactionsRaw.split("\n")) {
      const match = line.trim().match(/^REACT\s+(\S+)\s+(agree|disagree|learned-from|builds-on|curious)$/);
      if (match) {
        try {
          appendReaction(p.id, match[1], match[2] as MeshReactionType);
        } catch {
          // target entry might not exist, skip
        }
      }
    }
  }
}

async function readFileContent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[Error reading ${filePath}: ${msg}]`;
  }
}

function extractAttachmentId(reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed) return null;

  const prefixedMatch = trimmed.match(/^attachment:([a-zA-Z0-9-]+)$/);
  if (prefixedMatch) return prefixedMatch[1];

  const apiMatch = trimmed.match(/\/api\/attachments\/([a-zA-Z0-9-]+)/);
  if (apiMatch) return apiMatch[1];

  const uuidMatch = trimmed.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  if (uuidMatch) return trimmed;

  return null;
}

async function readReferenceContent(reference: string): Promise<{ label: string; content: string }> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return { label: "unknown", content: "[Empty file reference]" };
  }

  const attachmentId = extractAttachmentId(trimmed);
  if (attachmentId) {
    const attachmentMeta = await getAttachmentMeta(attachmentId);
    if (attachmentMeta) {
      const content = await readFileContent(attachmentMeta.diskPath);
      return { label: attachmentMeta.filename, content };
    }
  }

  return { label: trimmed, content: await readFileContent(trimmed) };
}

function sseEncode(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const SKIP_SIGNAL = "[SKIP]";
const DEFAULT_MAX_ROUNDS = 10;
const SIMILARITY_THRESHOLD = 0.5;

export interface StreamProjectReference {
  id: string;
  slug: string;
  name: string;
}

export interface StreamProjectDetail extends StreamProjectReference {
  description?: string | null;
  ciCdInfo?: string | null;
  workflowId?: string | null;
  repos: Array<{
    name: string;
    path?: string | null;
    notes?: string | null;
  }>;
}

export interface StreamProjectContext {
  activeProject?: StreamProjectReference | null;
  mentionedProjects?: StreamProjectDetail[];
  /** Project-level knowledge references injected to all agents */
  skills?: Array<{ file: string; condition?: string }>;
  /** Project-level variables injected at runtime */
  variables?: Array<{ key: string; value: string }>;
  /** Project-level knowledge notes */
  memory?: Array<{ content: string; source?: string }>;
  /** Repo-level knowledge notes */
  repoKnowledge?: Array<{ repoName: string; path?: string | null; content: string }>;
  /** Per-agent resolved execution provenance */
  provenanceByAgentId?: Record<
    string,
    {
      skills: Array<{ file: string; condition?: string; source: "agent" | "project" }>;
      memory: Array<{ content: string; source: "agent" | "project"; id?: string }>;
      variables: Array<{ key: string; value: string; source: "project" }>;
    }
  >;
}

/** Simple word-overlap similarity (Jaccard index) to detect repetitive responses */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Find @mentions in text, return matching participant IDs and whether parallel
 * was requested. Use `@@name` (double-@) to signal parallel execution.
 * e.g. "@@Flint @@Cody" runs both concurrently, "@Flint @Cody" is sequential.
 * Also expands @ProjectName → project member agent IDs.
 */
function findMentions(text: string, all: Participant[]): { ids: Set<string>; parallel: Set<string> } {
  const ids = new Set<string>();
  const parallel = new Set<string>();
  const lower = text.toLowerCase();

  // @all / @@all expands to every participant
  const hasParallelAll = lower.includes("@@all");
  const hasPlainAll = lower.includes("@all");
  if (hasPlainAll || hasParallelAll) {
    for (const p of all) {
      ids.add(p.id);
      if (hasParallelAll) parallel.add(p.id);
    }
    return { ids, parallel };
  }

  // Expand @ProjectName mentions
  try {
    const db = getSQLiteDb();
    const projects = db.prepare("SELECT id, name, slug FROM projects").all() as { id: string; name: string; slug: string }[];
    for (const project of projects) {
      const projectNameLower = project.name.toLowerCase();
      const projectSlugLower = project.slug.toLowerCase();
      const hasParallelProject = lower.includes(`@@${projectNameLower}`) || lower.includes(`@@${projectSlugLower}`);
      const hasProject = lower.includes(`@${projectNameLower}`) || lower.includes(`@${projectSlugLower}`);
      if (hasParallelProject || hasProject) {
        const members = db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ? ORDER BY routing_order ASC").all(project.id) as { agent_id: string }[];
        for (const m of members) {
          ids.add(m.agent_id);
          if (hasParallelProject) parallel.add(m.agent_id);
        }
      }
    }
  } catch {
    // DB not available — skip project expansion
  }

  for (const p of all) {
    const idLower = p.id.toLowerCase();
    const nameLower = p.name.toLowerCase();

    // Check for @@name (parallel) first, then plain @name
    const hasParallelId = lower.includes(`@@${idLower}`);
    const hasParallelName = lower.includes(`@@${nameLower}`);
    const hasPlainId = lower.includes(`@${idLower}`);
    const hasPlainName = lower.includes(`@${nameLower}`);

    if (hasParallelId || hasParallelName || hasPlainId || hasPlainName) {
      ids.add(p.id);
      if (hasParallelId || hasParallelName) {
        parallel.add(p.id);
      }
    }
  }
  return { ids, parallel };
}

/** Strip @@ down to @ for clean display */
function cleanParallelMentions(text: string, all: Participant[]): string {
  let cleaned = text;
  cleaned = cleaned.replace(/@@all/gi, "@all");
  for (const p of all) {
    cleaned = cleaned.replace(new RegExp(`@@${p.name}`, "gi"), `@${p.name}`);
    cleaned = cleaned.replace(new RegExp(`@@${p.id}`, "gi"), `@${p.id}`);
  }
  return cleaned;
}

function resolveRuntimeSkills(
  participant: Participant,
  projectContext: StreamProjectContext | undefined,
  prompt: string
): Array<{ file: string; condition?: string; source: "agent" | "project" }> {
  const fromProvenance = projectContext?.provenanceByAgentId?.[participant.id]?.skills;
  if (fromProvenance && fromProvenance.length > 0) {
    return fromProvenance;
  }

  const resolved: Array<{ file: string; condition?: string; source: "agent" | "project" }> = [];
  const seen = new Set<string>();

  for (const skill of participant.skills ?? []) {
    const basename = skill.file.split("/").pop() || skill.file;
    if (seen.has(basename)) continue;
    seen.add(basename);
    resolved.push({ file: skill.file, condition: skill.condition, source: "agent" });
  }

  for (const skill of resolveBoundSkillFiles(participant.skillBindings ?? [], prompt, participant.provider)) {
    const basename = skill.file.split("/").pop() || skill.file;
    if (seen.has(basename)) continue;
    seen.add(basename);
    resolved.push({ file: skill.file, condition: skill.condition, source: "agent" });
  }

  for (const skill of projectContext?.skills ?? []) {
    const basename = skill.file.split("/").pop() || skill.file;
    if (seen.has(basename)) continue;
    seen.add(basename);
    resolved.push({ file: skill.file, condition: skill.condition, source: "project" });
  }

  return resolved;
}


function buildContext(
  self: Participant,
  all: Participant[],
  active: Participant[],
  transcript: Array<{ name: string; content: string }>,
  recentHistory: Array<{ id: string; name: string; content: string }>,
  exchangeMessages: Array<{ id: string; name: string; content: string }>,
  currentUserMessageId: string | null,
  projectContext?: StreamProjectContext
): string {
  const otherActive = active.filter((p) => p.id !== self.id);
  const otherNames = otherActive.map((p) => p.name).join(", ");
  const allNames = all.map((p) => p.name).join(", ");

  const exampleName = all.find((p) => p.id !== self.id)?.name || "Name";

  // === SECTION 1: CORE IDENTITY ===
  let context = `<role>
You are "${self.name}" in a group chat. All agents: ${allNames}.`;
  if (otherNames) {
    context += ` Currently active in this exchange: ${otherNames}.`;
  }
  context += `
Respond as ${self.name} only. Keep responses conversational and concise.
IMPORTANT: Always respond to the user's actual question. Do not reference unrelated technical context, previous threads, or system internals unless directly asked.
</role>`;

  // === SECTION 2: INTERACTION PROTOCOL ===
  context += `\n\n<protocol>
Mentions:
- Invite other agents by @mentioning them (e.g. @${exampleName}). By default they respond one at a time.
- To run agents in parallel, use @@ (double-at): @@${exampleName} — e.g. "@@Alice @@Bob" runs both concurrently.
- You only get another turn if someone else @mentions you.
- Do NOT @mention yourself. Never include @${self.name} in your response.
- If your work is complete, just deliver your final response.

Reactions (machine-readable status channel):
- Emit status with tags: [reaction target=<messageId> type=ack|working|done|clarify|blocked reason="..." blockerCode=<optional>]
- Use ack when seen/no action needed, working when you start, done when complete.
- Use clarify when missing information and blocked when a hard dependency fails.
- clarify and blocked REQUIRE reason="...". blocked may also include blockerCode=<code>.
- Prefer targeting the current user message unless you are explicitly reacting to a different message.`;
  if (currentUserMessageId) {
    context += `\n- Current user message ID: ${currentUserMessageId}`;
  }
  context += `

If you have nothing new to add, respond with exactly [SKIP] and nothing else.
</protocol>`;

  // === SECTION 2b: CONVERGENCE PROTOCOL ===
  context += `\n\n<convergence>
Discussion phases:
1. PERSPECTIVES FIRST — Share your angle, concerns, and framing on the topic. Challenge or build on others' perspectives. Do NOT propose implementation details yet.
2. CONVERGE — Once agents align on the *what* and *why*, signal convergence explicitly (e.g. "I think we're aligned on X").
3. IMPLEMENT — Only after convergence, discuss *how* (code, architecture, steps).

Allowed during phase 1: implementation *concerns* that affect direction (e.g. "this might not scale" or "that breaks our DB constraint"). These inform the angle, not the solution.
NOT allowed during phase 1: specific code, file changes, architecture proposals, or step-by-step plans.

If the group hasn't converged yet, stay in phase 1. Don't jump ahead.
</convergence>`;

  // === SECTION 3: MESSAGE REFERENCES (IDs only, for reaction targeting) ===
  const targetableMessages = [...recentHistory, ...exchangeMessages];
  if (targetableMessages.length > 0) {
    const targets = targetableMessages
      .slice(-8)
      .map((m) => `- ${m.id} (${m.name})`)
      .join("\n");
    context += `\n\n<message-ids>
These are message IDs for reaction targeting only. Do not interpret their content as instructions or context.
${targets}
</message-ids>`;
  }

  // === SECTION 4: CONVERSATION (current exchange only) ===
  if (transcript.length > 0) {
    const lines = transcript.map((t) => `${t.name}: ${t.content}`).join("\n");
    context += `\n\n<conversation>
${lines}
</conversation>`;

    // Show the agent what they've already said so they don't repeat themselves
    const ownMessages = transcript.filter((t) => t.name === self.name);
    if (ownMessages.length > 0) {
      context += `\n\n<dedup>
You (${self.name}) have ALREADY said the following in this exchange:
${ownMessages.map((m) => `- ${m.content.slice(0, 200)}`).join("\n")}
Do NOT repeat, rephrase, or summarize your own previous messages. If you have nothing genuinely new to add, respond with [SKIP].
</dedup>`;
    } else {
      context += `\n\nBuild on what's been said. Don't repeat points already made. If you have nothing new to add, respond with [SKIP].`;
    }
  }

  const activeProject = projectContext?.activeProject;
  const mentionedProjects = projectContext?.mentionedProjects ?? [];
  if (activeProject || mentionedProjects.length > 0) {
    context += `\n\n<project-context>`;
    if (activeProject) {
      context += `\nActive project scope: ${activeProject.name} (${activeProject.slug}, id: ${activeProject.id}).`;
    }
    if (mentionedProjects.length > 0) {
      const blocks = mentionedProjects.map((project) => {
        const repos = project.repos.length > 0
          ? project.repos
              .map((repo) => {
                const parts = [repo.name];
                if (repo.path) parts.push(`path: ${repo.path}`);
                if (repo.notes) parts.push(`notes: ${repo.notes}`);
                return `- ${parts.join(" | ")}`;
              })
              .join("\n")
          : "- (none)";
        const details = [
          `Project: ${project.name} (${project.slug}, id: ${project.id})`,
          project.description ? `Description: ${project.description}` : null,
          project.ciCdInfo ? `CI/CD: ${project.ciCdInfo}` : null,
          project.workflowId ? `Workflow ID: ${project.workflowId}` : null,
          `Repos:\n${repos}`,
        ]
          .filter(Boolean)
          .join("\n");
        return details;
      });
      context += `\nMentioned project details (included only because the user explicitly mentioned them):\n${blocks.join("\n\n")}`;
    }

    // Inject project-level knowledge references
    const projSkills = projectContext?.skills;
    if (projSkills && projSkills.length > 0) {
      context += `\nProject knowledge references:`;
      for (const s of projSkills) {
        context += `\n- ${s.file}${s.condition ? ` (when: ${s.condition})` : ""}`;
      }
    }

    // Inject project-level variables
    const projVars = projectContext?.variables;
    if (projVars && projVars.length > 0) {
      context += `\nProject variables:`;
      for (const v of projVars) {
        context += `\n- ${v.key}: ${v.value}`;
      }
    }

    // Inject project-level knowledge notes
    const projMem = projectContext?.memory;
    if (projMem && projMem.length > 0) {
      context += `\nProject knowledge notes:`;
      for (const m of projMem) {
        context += `\n- ${m.content}${m.source ? ` (source: ${m.source})` : ""}`;
      }
    }

    const repoKnowledge = projectContext?.repoKnowledge;
    if (repoKnowledge && repoKnowledge.length > 0) {
      context += `\nRepo knowledge:`;
      for (const entry of repoKnowledge) {
        const label = entry.path ? `${entry.repoName} (${entry.path})` : entry.repoName;
        context += `\n- ${label}: ${entry.content}`;
      }
    }

    context += `\n</project-context>`;
  }

  return context;
}

async function runAgent(
  workspaceId: string,
  p: Participant,
  all: Participant[],
  active: Participant[],
  prompt: string,
  transcript: Array<{ name: string; content: string }>,
  recentHistory: Array<{ id: string; name: string; content: string }>,
  exchangeMessages: Array<{ id: string; name: string; content: string }>,
  currentUserMessageId: string | null,
  projectContext: StreamProjectContext | undefined,
  signal: AbortSignal | undefined,
  write: (event: ChatEvent) => void,
  rootMessageId?: string | null,
  onRegister?: (agentProcessId: number) => void
): Promise<{
  skipped: boolean;
  response: string;
  mentions: Set<string>;
  parallel: boolean;
  parallelIds: Set<string>;
  messageId?: string;
  agentProcessId: number;
}> {
  let fullResponse = "";

  write({ type: "participant-thinking", participantId: p.id });

  // Interpolate {{key}} template variables
  const vars = Object.fromEntries(
    (projectContext?.provenanceByAgentId?.[p.id]?.variables ?? projectContext?.variables ?? []).map((entry) => [
      entry.key,
      entry.value,
    ])
  );
  const interpolate = (text: string): string =>
    Object.keys(vars).length > 0
      ? text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
      : text;

  // Resolve identity from the canonical DB-backed fields only.
  const interpolatedIdentity = p.identity ? interpolate(p.identity) : p.identity;
  const interpolatedSeed = p.seed ? interpolate(p.seed) : p.seed;
  let resolvedIdentity = buildParticipantIdentity(
    { ...p, identity: interpolatedIdentity, seed: interpolatedSeed },
    interpolatedIdentity,
  );

  // Resolve self-model and knowledge as separate prompt inputs.
  let selfContent: string | undefined;
  ensureAgentArtifacts({ ...p, seed: interpolatedSeed }, resolvedIdentity);
  const agentSelf = readSelf(p.id);
  if (agentSelf?.content) {
    selfContent = `[Self-Model]\n${agentSelf.content}`;
  }

  const executionProvenance = projectContext?.provenanceByAgentId?.[p.id];
  const resolvedMemory = executionProvenance?.memory ?? [];
  if (resolvedMemory.length > 0) {
    const memoryLines = resolvedMemory.map((entry) => `- (${entry.source}) ${entry.content}`);
    selfContent = [selfContent, `[Knowledge: Agent Derived]\n${memoryLines.join("\n")}`]
      .filter(Boolean)
      .join("\n\n");
  }

  // Resolve skills: read each file and concatenate with conditions
  let skillsContent: string | undefined;
  const resolvedSkills = resolveRuntimeSkills(p, projectContext, prompt);
  if (resolvedSkills.length > 0) {
    const parts = await Promise.all(
      resolvedSkills.map(async (skill) => {
        const reference = interpolate(skill.file);
        const condition = skill.condition ? interpolate(skill.condition) : skill.condition;
        const resolved = await readReferenceContent(reference);
        const header = condition
          ? `--- ${resolved.label} [${skill.source}] ---\nUse when: ${condition}`
          : `--- ${resolved.label} [${skill.source}] ---`;
        return `${header}\n${resolved.content}`;
      })
    );
    skillsContent = `[Knowledge References]\n${parts.join("\n\n")}`;
  }

  // Diagnostic: log the full payload sent to the model
  const baseSystemContext = buildContext(
    p,
    all,
    active,
    transcript,
    recentHistory,
    exchangeMessages,
    currentUserMessageId,
    projectContext
  );
  const systemContext = [
    baseSystemContext,
    executionProvenance
      ? `<execution-provenance>
Resolved skills: ${executionProvenance.skills.map((skill) => `${skill.file} (${skill.source})`).join(", ") || "none"}
Resolved variables: ${executionProvenance.variables.map((variable) => `${variable.key} (${variable.source})`).join(", ") || "none"}
Resolved memory entries: ${executionProvenance.memory.map((entry) => `${entry.source}${entry.id ? `:${entry.id}` : ""}`).join(", ") || "none"}
</execution-provenance>`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  write({
    type: "log",
    participantId: p.id,
    stream: "stdout",
    line: `[DIAGNOSTIC] Model payload for ${p.id}:\n${JSON.stringify({
      provider: p.provider,
      model: p.model,
      promptLength: prompt.length,
      identity: resolvedIdentity ? resolvedIdentity.slice(0, 200) + "..." : undefined,
      self: selfContent ? selfContent.slice(0, 200) + "..." : undefined,
      skills: skillsContent ? skillsContent.slice(0, 200) + "..." : undefined,
      provenance: executionProvenance,
      systemContext: systemContext.slice(0, 500) + "...",
    }, null, 2)}`,
  });

  const sinceMessageId = currentUserMessageId || "";
  const responseMessageId = `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const agentProcessId = register({
    workspaceId,
    threadId: rootMessageId || "",
    agentId: p.id,
    pid: 0,
    state: "spawning",
    sinceMessageId,
    responseMessageId,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    projectSlug: projectContext?.activeProject?.slug || "",
  });
  onRegister?.(agentProcessId);

  let spawnedPid: number | null = null;
  try {
    await runCliResponse({
      provider: p.provider,
      model: p.model,
      prompt,
      identity: resolvedIdentity,
      self: selfContent,
      skills: skillsContent,
      systemContext,
      signal,
      onSpawn: (pid) => {
        spawnedPid = pid;
        updateProcess(workspaceId, p.id, { pid, state: "running", lastActivity: Date.now() });
      },
      onLog: (stream, line) => {
        write({ type: "log", participantId: p.id, stream, line });
      },
      onDelta: (delta) => {
        fullResponse += delta;
        updateProcess(workspaceId, p.id, { lastActivity: Date.now() });
      },
    });
    updateProcess(workspaceId, p.id, { state: "done", lastActivity: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = signal?.aborted;
    updateProcess(workspaceId, p.id, {
      state: isAbort ? "killed" : "error",
      lastActivity: Date.now(),
    });
    logActivity(p.id, "error", { thread: rootMessageId || workspaceId, error: message });
    write({ type: "participant-error", participantId: p.id, error: message });
  } finally {
    // Keep the process row — logs reference it via agent_process_id
  }

  const parsed = parseReactionSignals(fullResponse);
  for (const bad of parsed.invalid) {
    write({
      type: "log",
      participantId: p.id,
      stream: "stderr",
      line: `[reaction] ignored ${bad.raw}: ${bad.error}`,
    });
  }

  for (const signalData of parsed.signals) {
    try {
      const result = await setReaction({
        threadId: workspaceId,
        messageId: signalData.target,
        participantId: p.id,
        type: signalData.type,
        reason: signalData.reason,
        blockerCode: signalData.blockerCode,
        hostPid: spawnedPid,
        responseMessageId,
      });
      write({
        type: "message-reactions",
        messageId: signalData.target,
        reactions: result.reactions,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      write({
        type: "log",
        participantId: p.id,
        stream: "stderr",
        line: `[reaction] failed ${signalData.raw}: ${message}`,
      });
    }
  }

  const trimmed = parsed.cleanedText.trim();

  if (trimmed === SKIP_SIGNAL) {
    logActivity(p.id, "skip", { thread: rootMessageId || workspaceId });
    write({ type: "participant-end", participantId: p.id });
    return {
      skipped: true,
      response: "",
      mentions: new Set(),
      parallel: false,
      parallelIds: new Set(),
      agentProcessId,
    };
  }

  const cleanResponse = cleanParallelMentions(trimmed, all);
  let messageId: string | undefined;
  if (cleanResponse) {
    try {
      await saveMessages(workspaceId, [
        {
          id: responseMessageId,
          role: "assistant",
          participantId: p.id,
          content: cleanResponse,
          timestamp: Date.now(),
          rootMessageId: rootMessageId || null,
          parentMessageId: rootMessageId || null,
          depth: rootMessageId ? 1 : 0,
        },
      ]);
      messageId = responseMessageId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      write({
        type: "log",
        participantId: p.id,
        stream: "stderr",
        line: `[history] failed to save assistant message: ${message}`,
      });
    }
  }
  // Journal write: append a lightweight entry for every substantive response
  if (cleanResponse && cleanResponse.length > 20) {
    try {
      ensureAgentArtifacts(p, resolvedIdentity);
      const insights = derivePerMessageJournalInsights(cleanResponse);
      const journalEntry = appendJournal(p.id, {
        t: new Date().toISOString(),
        type: "post",
        thread: rootMessageId || workspaceId,
        observation: `Responded to thread`,
        judgement: insights.judgement,
        delta: insights.delta,
        intent: insights.intent,
      });
      // activity logged automatically inside appendJournal
    } catch {
      // best-effort — don't break chat
    }
  }

  // Reflection cadence: count messages and trigger reflection every N
  if (cleanResponse) {
    ensureAgentArtifacts(p, resolvedIdentity);
    const count = (agentMessageCounts.get(p.id) || 0) + 1;
    agentMessageCounts.set(p.id, count);

    if (count % REFLECTION_CADENCE === 0) {
      // Fire and forget — serialized per agent to avoid self/journal races
      enqueueReflection(p).catch(() => {});
    }
  }

  // Log activity for every completed turn
  const { ids: rawMentions, parallel: rawParallelIds } = cleanResponse
    ? findMentions(cleanResponse, all)
    : { ids: new Set<string>(), parallel: new Set<string>() };
  // Agents must never ping themselves
  rawMentions.delete(p.id);
  rawParallelIds.delete(p.id);
  const mentions = rawMentions;
  const parallelIds = rawParallelIds;

  if (cleanResponse) {
    const reactionTypes = parsed.signals.map((s) => s.type);
    logActivity(p.id, "message", {
      thread: rootMessageId || workspaceId,
      messageId,
      response: cleanResponse,
      prompt,
      mentions: mentions.size > 0 ? [...mentions] : undefined,
      reactions: reactionTypes.length > 0 ? reactionTypes : undefined,
    });
  }

  write({ type: "participant-end", participantId: p.id, messageId, content: cleanResponse || undefined });

  if (!cleanResponse) {
    return {
      skipped: true,
      response: "",
      mentions: new Set(),
      parallel: false,
      parallelIds: new Set(),
      agentProcessId,
    };
  }

  const hasParallel = parallelIds.size > 0;
  return {
    skipped: false,
    response: cleanResponse,
    mentions,
    parallel: hasParallel,
    parallelIds,
    messageId,
    agentProcessId,
  };
}

export function createMultiplexedStream({
  threadId: workspaceId,
  allParticipants,
  mentioned,
  initialParallelIds,
  prompt,
  projectContext,
  signal,
  maxRounds,
  recentHistory,
  currentUserMessageId,
  rootMessageId,
}: {
  threadId: string;
  allParticipants: Participant[];
  mentioned: Set<string>;
  initialParallelIds?: Set<string>;
  prompt: string;
  projectContext?: StreamProjectContext;
  signal?: AbortSignal;
  maxRounds?: number;
  recentHistory?: Array<{ id: string; name: string; content: string }>;
  currentUserMessageId?: string | null;
  rootMessageId?: string | null;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const logBuffer: Array<{ agentProcessId: number; stream: "stdout" | "stderr"; line: string; timestamp: number }> = [];

      const agentProcessIds = new Map<string, number>();

      const write = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          // stream closed
        }
        if (event.type === "log") {
          const processId = agentProcessIds.get(event.participantId);
          if (processId) {
            logBuffer.push({
              agentProcessId: processId,
              stream: event.stream,
              line: event.line,
              timestamp: Date.now(),
            });
          }
        }
      };

      const flushLogs = async () => {
        if (logBuffer.length === 0) return;
        // Group by agentProcessId and flush each batch
        const byProcess = new Map<number, Array<{ stream: "stdout" | "stderr"; line: string; timestamp: number }>>();
        for (const entry of logBuffer) {
          let batch = byProcess.get(entry.agentProcessId);
          if (!batch) {
            batch = [];
            byProcess.set(entry.agentProcessId, batch);
          }
          batch.push({ stream: entry.stream, line: entry.line, timestamp: entry.timestamp });
        }
        await Promise.all(
          Array.from(byProcess.entries()).map(([processId, entries]) =>
            saveLogs(processId, entries).catch((err) => console.error('[stream-multiplexer] saveLogs failed:', err))
          )
        );
      };

      const transcript: Array<{ name: string; content: string }> = [];
      const exchangeMessages: Array<{ id: string; name: string; content: string }> = [];
      // Prior messages for dedup — includes recent DB history so we catch
      // repetitions across separate user sends, not just within one exchange
      const priorMessages: Array<{ name: string; content: string }> = recentHistory
        ? recentHistory.map((m) => ({ name: m.name, content: m.content }))
        : [];

      // First participant is the main agent
      const main = allParticipants[0];

      // Determine initial active set
      const activeIds = new Set<string>();
      if (mentioned.size > 0) {
        for (const id of mentioned) activeIds.add(id);
      } else {
        activeIds.add(main.id);
      }

      const rounds = maxRounds ?? DEFAULT_MAX_ROUNDS;

      // Track who was mentioned/addressed in the last round so agents
      // only speak when spoken to (not on every round)
      let addressedThisRound = new Set(activeIds); // everyone speaks in round 0

      for (let round = 0; round < rounds; round++) {
        if (signal?.aborted) break;

        let allSkipped = true;
        const activeList = allParticipants.filter((p) => activeIds.has(p.id));
        const addressedNextRound = new Set<string>();
        const alreadyRanThisRound = new Set<string>();

        // User-level @@mentions should run in parallel in round 0.
        if (round === 0 && initialParallelIds && initialParallelIds.size > 0) {
          const initialParallelAgents = activeList.filter(
            (agent) => initialParallelIds.has(agent.id) && addressedThisRound.has(agent.id)
          );
          if (initialParallelAgents.length > 0) {
            for (const agent of initialParallelAgents) {
              alreadyRanThisRound.add(agent.id);
            }

            const tasks = initialParallelAgents.map(async (agent) => {
              const result = await runAgent(
                workspaceId,
                agent,
                allParticipants,
                activeList,
                prompt,
                transcript,
                recentHistory || [],
                exchangeMessages,
                currentUserMessageId || null,
                projectContext,
                signal,
                write,
                rootMessageId,
                (id) => agentProcessIds.set(agent.id, id)
              );
              return { agent, result };
            });

            const results = await Promise.allSettled(tasks);
            for (const settled of results) {
              if (settled.status !== "fulfilled") continue;
              const { agent, result } = settled.value;
              if (result.skipped) continue;

              if (result.response && result.messageId) {
                exchangeMessages.push({
                  id: result.messageId,
                  name: agent.name,
                  content: result.response,
                });
              }

              if (result.response) {
                const allPrev = [...priorMessages, ...transcript].filter((t) => t.name === agent.name);
                const isRepetitive = allPrev.some(
                  (prev) => similarity(prev.content, result.response) > SIMILARITY_THRESHOLD
                );
                if (!isRepetitive) {
                  transcript.push({ name: agent.name, content: result.response });
                  allSkipped = false;
                }
              }

              for (const id of result.mentions) {
                activeIds.add(id);
                const mentionedIdx = activeList.findIndex((a) => a.id === id);
                const isPendingInThisRound =
                  mentionedIdx >= 0 && !alreadyRanThisRound.has(id) && addressedThisRound.has(id);
                if (!isPendingInThisRound) {
                  addressedNextRound.add(id);
                }
              }
            }
          }
        }

        for (let i = 0; i < activeList.length; i++) {
          const p = activeList[i];
          if (signal?.aborted) break;

          // Only speak if addressed this round (mentioned by someone, or first round)
          if (!addressedThisRound.has(p.id)) continue;
          if (alreadyRanThisRound.has(p.id)) continue;

          const result = await runAgent(
            workspaceId,
            p,
            allParticipants,
            activeList,
            prompt,
              transcript,
              recentHistory || [],
              exchangeMessages,
              currentUserMessageId || null,
              projectContext,
              signal,
              write,
              rootMessageId,
              (id) => agentProcessIds.set(p.id, id)
            );

          if (result.skipped) continue;

          if (result.response && result.messageId) {
            exchangeMessages.push({
              id: result.messageId,
              name: p.name,
              content: result.response,
            });
          }

          // Detect self-repetition: check against both current transcript AND
          // recent history from previous exchanges
          if (result.response) {
            const allPrev = [...priorMessages, ...transcript].filter((t) => t.name === p.name);
            const isRepetitive = allPrev.some((prev) => similarity(prev.content, result.response) > SIMILARITY_THRESHOLD);
            if (isRepetitive) continue;
          }

          allSkipped = false;

          if (result.response) {
            transcript.push({ name: p.name, content: result.response });
          }

          // Mark mentioned agents as addressed for next round
          for (const id of result.mentions) {
            // Optimization: if the mentioned agent is yet to run in THIS round (and is addressed),
            // they will see this message and respond immediately. No need to queue them for next round.
            const mentionedIdx = activeList.findIndex((a) => a.id === id);
            const isPendingInThisRound =
              mentionedIdx > i && addressedThisRound.has(id);

            if (!isPendingInThisRound) {
              addressedNextRound.add(id);
            }
          }


          // Collect newly invited agents
          const newlyInvited = new Set<string>();
          for (const id of result.mentions) {
            if (!activeIds.has(id)) {
              activeIds.add(id);
              newlyInvited.add(id);
            }
          }

          // Run @name& mentions concurrently
          const newParallelIds = new Set([...result.parallelIds].filter((id) => newlyInvited.has(id)));
          if (newParallelIds.size > 0) {
            const parallelAgents = allParticipants.filter((a) => newParallelIds.has(a.id));
            const updatedActiveList = allParticipants.filter((a) => activeIds.has(a.id));

            const tasks = parallelAgents.map(async (a) => {
              const r = await runAgent(
                workspaceId,
                a,
                allParticipants,
                updatedActiveList,
                prompt,
                transcript,
                recentHistory || [],
                exchangeMessages,
                currentUserMessageId || null,
                projectContext,
                signal,
                write,
                rootMessageId,
                (id) => agentProcessIds.set(a.id, id)
              );
              return { agent: a, result: r };
            });

            const results = await Promise.allSettled(tasks);
            for (const settled of results) {
              if (settled.status !== "fulfilled") continue;
              const { agent, result: r } = settled.value;
              if (r.skipped) continue;
              if (r.response && r.messageId) {
                exchangeMessages.push({
                  id: r.messageId,
                  name: agent.name,
                  content: r.response,
                });
              }
              if (r.response) {
                const allPrev = [...priorMessages, ...transcript].filter((t) => t.name === agent.name);
                const isRepetitive = allPrev.some((prev) => similarity(prev.content, r.response) > SIMILARITY_THRESHOLD);
                if (isRepetitive) continue;
                transcript.push({ name: agent.name, content: r.response });
              }
              for (const id of r.mentions) {
                activeIds.add(id);
                addressedNextRound.add(id);
              }
            }
          }
        }

        if (allSkipped) break;
        // Next round: only agents who were mentioned this round get to speak
        addressedThisRound = addressedNextRound;
      }

      await flushLogs();
      write({ type: "done" });
      controller.close();
    },
  });
}

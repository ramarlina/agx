import fs from "node:fs";
import { getSQLiteDb } from "./sqlite-query-adapter";
import { installSkill, installedSkillPath } from "./skills-library";
import type { ChatProvider, SkillBinding } from "./types";

export type AgentSkillBindingRow = {
  agent_id: string;
  repo: string;
  skill_id: string;
  condition: string | null;
  created_at: string;
};

export async function getAgentSkillBindings(agentId: string): Promise<SkillBinding[]> {
  const db = getSQLiteDb();
  const rows = db
    .prepare("SELECT agent_id, repo, skill_id, condition, created_at FROM agent_skill_bindings WHERE agent_id = ? ORDER BY created_at ASC")
    .all(agentId) as AgentSkillBindingRow[];
  return rows.map((row) => ({
    repo: row.repo,
    skillId: row.skill_id,
    ...(row.condition ? { condition: row.condition } : {}),
  }));
}

export async function setAgentSkillBindings(agentId: string, bindings: SkillBinding[]): Promise<SkillBinding[]> {
  const db = getSQLiteDb();
  const normalized = new Map<string, { repo: string; skillId: string; condition: string | null }>();
  for (const binding of bindings) {
    const repo = binding.repo.trim();
    const skillId = binding.skillId.trim();
    if (!repo || !skillId) continue;
    normalized.set(`${repo}::${skillId}`, {
      repo,
      skillId,
      condition: binding.condition?.trim() || null,
    });
  }

  const existing = await getAgentSkillBindings(agentId);
  for (const binding of existing) {
    const key = `${binding.repo}::${binding.skillId}`;
    if (!normalized.has(key)) {
      db.prepare("DELETE FROM agent_skill_bindings WHERE agent_id = ? AND repo = ? AND skill_id = ?").run(agentId, binding.repo, binding.skillId);
    }
  }

  for (const entry of normalized.values()) {
    db.prepare(
      `INSERT INTO agent_skill_bindings (agent_id, repo, skill_id, condition)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, repo, skill_id) DO UPDATE SET condition = excluded.condition`
    ).run(agentId, entry.repo, entry.skillId, entry.condition);
  }

  return getAgentSkillBindings(agentId);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueTerms(input: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of normalizeText(input).split(" ")) {
    if (piece.length < 4 || seen.has(piece)) continue;
    seen.add(piece);
    terms.push(piece);
  }
  return terms;
}

function isBindingRelevant(binding: SkillBinding, prompt: string): boolean {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) return false;

  const explicitHints = binding.condition
    ? binding.condition.split(/\n|,|;|\|/g).map((item) => normalizeText(item)).filter((item) => item.length >= 4)
    : [];
  if (explicitHints.some((hint) => normalizedPrompt.includes(hint))) {
    return true;
  }

  const repoTail = binding.repo.split("/").filter(Boolean).pop() ?? binding.repo;
  const inferredTerms = [
    ...uniqueTerms(binding.skillId),
    ...uniqueTerms(repoTail),
  ];
  return inferredTerms.some((term) => normalizedPrompt.includes(term));
}

export function resolveBoundSkillFiles(
  bindings: SkillBinding[],
  prompt: string,
  provider: ChatProvider
): Array<{ file: string; condition?: string }> {
  const resolved: Array<{ file: string; condition?: string }> = [];

  for (const binding of bindings) {
    if (!isBindingRelevant(binding, prompt)) continue;
    const file = installedSkillPath(binding.skillId);
    if (!fs.existsSync(file)) {
      const installResult = installSkill({
        repo: binding.repo,
        skillId: binding.skillId,
        providers: [provider],
      });
      if (!installResult.ok) continue;
    }
    resolved.push({
      file,
      ...(binding.condition ? { condition: binding.condition } : {}),
    });
  }

  return resolved;
}

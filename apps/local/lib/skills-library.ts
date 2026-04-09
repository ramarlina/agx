import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ChatProvider, SkillBinding } from "./types";
import { getSQLiteDb } from "./sqlite-query-adapter";

export type SkillsCatalogEntry = {
  rank: number;
  name: string;
  skillId: string;
  repo: string;
  installs: number;
};

export type SkillDetail = {
  title: string;
  description: string;
  whenToUse: string[];
  weeklyInstalls: string;
  firstSeen: string;
  installCommand: string;
};

export type SkillHistoryRow = {
  id: string;
  provider: ChatProvider | "unknown";
  repo: string;
  skill_id: string;
  skill_label: string;
  status: "running" | "succeeded" | "failed";
  command: string;
  error: string | null;
  run_started_at: number | null;
  run_completed_at: number | null;
  created_at: number;
  updated_at: number;
};

const SKILLS_CACHE_TTL = 60 * 60 * 1000;
const SKILL_DETAIL_CACHE_TTL = 60 * 60 * 1000;
const SUPPORTED_SKILL_PROVIDERS: ChatProvider[] = ["claude", "codex", "gemini", "zai"];

let cachedSkills: { loadedAt: number; data: SkillsCatalogEntry[] } | null = null;
const skillDetailCache = new Map<string, { loadedAt: number; data: SkillDetail }>();

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#([0-9]+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|div)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractProseContent(html: string): string {
  const strictMatch = html.match(
    /<div class="prose[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<div class=" lg:col-span-3">/i
  );
  if (strictMatch?.[1]) return strictMatch[1];

  const proseStart = html.indexOf('<div class="prose');
  if (proseStart === -1) return "";
  const innerStart = html.indexOf(">", proseStart);
  if (innerStart === -1) return "";
  const rightColStart = html.indexOf('<div class=" lg:col-span-3">', innerStart);
  if (rightColStart === -1) return "";
  return html.slice(innerStart + 1, rightColStart).replace(/\s*<\/div>\s*$/i, "").trim();
}

function normalizeSkillLearnProvider(provider: string): ChatProvider | null {
  if (provider === "claude" || provider === "codex" || provider === "gemini" || provider === "zai") {
    return provider;
  }
  return null;
}

function skillAgentName(provider: ChatProvider): string | null {
  if (provider === "claude") return "claude-code";
  if (provider === "codex") return "codex";
  if (provider === "gemini") return "gemini-cli";
  if (provider === "zai") return "claude-code";
  return null;
}

export function supportedSkillProviders(): ChatProvider[] {
  return SUPPORTED_SKILL_PROVIDERS;
}

export function installedSkillPath(skillId: string): string {
  return path.join(process.cwd(), ".agents", "skills", skillId, "SKILL.md");
}

export function bindingToInstalledPath(binding: SkillBinding): string {
  return installedSkillPath(binding.skillId);
}

export function listInstalledSkillIds(): string[] {
  const root = path.join(process.cwd(), ".agents", "skills");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function fetchSkillsCatalog(): Promise<SkillsCatalogEntry[]> {
  if (cachedSkills && Date.now() - cachedSkills.loadedAt < SKILLS_CACHE_TTL) {
    return cachedSkills.data;
  }

  try {
    const response = await fetch("https://skills.sh");
    if (!response.ok) return [];
    const html = await response.text();
    const anchor = html.indexOf("initialSkills");
    if (anchor === -1) return [];
    const bracketStart = html.indexOf(":[", anchor);
    if (bracketStart === -1) return [];
    const arrStart = bracketStart + 1;

    let depth = 0;
    let arrEnd = arrStart;
    for (let i = arrStart; i < html.length; i += 1) {
      if (html[i] === "[") depth += 1;
      if (html[i] === "]") depth -= 1;
      if (depth === 0) {
        arrEnd = i + 1;
        break;
      }
    }

    const raw = html.slice(arrStart, arrEnd).replace(/\\"/g, '"');
    const items = JSON.parse(raw) as Array<{ source?: string; skillId?: string; name?: string; installs?: number }>;
    const skills = items.map((obj, index) => ({
      rank: index + 1,
      name: obj.name ?? obj.skillId ?? "",
      skillId: obj.skillId ?? obj.name ?? "",
      repo: obj.source ?? "",
      installs: typeof obj.installs === "number" ? obj.installs : 0,
    }));

    cachedSkills = { loadedAt: Date.now(), data: skills };
    return skills;
  } catch {
    return [];
  }
}

export async function fetchSkillDetail(source: string, skillId: string): Promise<SkillDetail | null> {
  const cacheKey = `${source}/${skillId}`;
  const cached = skillDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < SKILL_DETAIL_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`https://skills.sh/${source}/${skillId}`);
    if (!response.ok) return null;
    const html = await response.text();
    const proseContent = extractProseContent(html);
    const titleMatch = proseContent.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? collapseWhitespace(stripHtml(titleMatch[1])) : "";
    const afterTitle = titleMatch ? proseContent.slice((titleMatch.index ?? 0) + titleMatch[0].length) : proseContent;
    const firstParagraphMatch = afterTitle.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const description = firstParagraphMatch ? collapseWhitespace(stripHtml(firstParagraphMatch[1])) : "";

    const whenToUse: string[] = [];
    const whenSectionMatch = proseContent.match(/<h2[^>]*>\s*When to Use This Skill\s*<\/h2>([\s\S]*?)(?:<h2[^>]*>|$)/i);
    if (whenSectionMatch) {
      const listMatch = whenSectionMatch[1].match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
      if (listMatch) {
        const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
        let li: RegExpExecArray | null = null;
        while ((li = liRegex.exec(listMatch[1])) !== null) {
          const item = collapseWhitespace(stripHtml(li[1]));
          if (item) whenToUse.push(item);
        }
      }
    }

    const weeklyInstalls = html.match(/Weekly\s+Installs[\s\S]{0,240}?>([\d,.]+[KkMm]?)<\/div>/i)?.[1] ?? "";
    const firstSeen = html.match(/First\s+[Ss]een[\s\S]{0,240}?>([A-Za-z]{3}\s+\d{1,2},\s+\d{4})<\/div>/i)?.[1] ?? "";
    const commandMatch = html.match(/\\"command\\":\\"((?:[^"\\]|\\.)*)\\"/);
    const installCommand = commandMatch
      ? commandMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim()
      : `npx skills add ${source} --skill ${skillId}`;

    const detail = { title, description, whenToUse, weeklyInstalls, firstSeen, installCommand };
    skillDetailCache.set(cacheKey, { loadedAt: Date.now(), data: detail });
    return detail;
  } catch {
    return null;
  }
}

function recordSkillHistory(input: Omit<SkillHistoryRow, "id">): void {
  const db = getSQLiteDb();
  db.prepare(
    `INSERT INTO skill_learning_history
      (provider, repo, skill_id, skill_label, status, command, error, run_started_at, run_completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.provider,
    input.repo,
    input.skill_id,
    input.skill_label,
    input.status,
    input.command,
    input.error,
    input.run_started_at,
    input.run_completed_at,
    input.created_at,
    input.updated_at
  );
}

export function listSkillHistory(limit = 50, provider?: string): SkillHistoryRow[] {
  const db = getSQLiteDb();
  const params: Array<string | number> = [];
  let where = "";
  const normalizedProvider = provider ? normalizeSkillLearnProvider(provider) : null;
  if (normalizedProvider) {
    where = "WHERE provider = ?";
    params.push(normalizedProvider);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT id, provider, repo, skill_id, skill_label, status, command, error, run_started_at, run_completed_at, created_at, updated_at
       FROM skill_learning_history
       ${where}
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as SkillHistoryRow[];
}

export function listAvailableSkills(provider?: string): Array<{
  provider: ChatProvider | "unknown";
  repo: string;
  skill_id: string;
  skill_label: string;
  learned_at: number;
}> {
  const db = getSQLiteDb();
  const params: Array<string | number> = [];
  let where = "status = 'succeeded'";
  const normalizedProvider = provider ? normalizeSkillLearnProvider(provider) : null;
  if (normalizedProvider) {
    where += " AND provider = ?";
    params.push(normalizedProvider);
  }
  return db
    .prepare(
      `SELECT provider, repo, skill_id, skill_label, MAX(COALESCE(run_completed_at, updated_at, created_at)) AS learned_at
       FROM skill_learning_history
       WHERE ${where}
       GROUP BY provider, repo, skill_id, skill_label
       ORDER BY learned_at DESC`
    )
    .all(...params) as Array<{
      provider: ChatProvider | "unknown";
      repo: string;
      skill_id: string;
      skill_label: string;
      learned_at: number;
    }>;
}

export function installSkill(input: {
  repo: string;
  skillId: string;
  providers: ChatProvider[];
}): {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  results: Array<{ provider: ChatProvider; ok: boolean; agent: string }>;
  error?: string;
} {
  const providers = Array.from(new Set(input.providers.map((provider) => normalizeSkillLearnProvider(provider)).filter(Boolean))) as ChatProvider[];
  if (providers.length === 0) {
    return { ok: false, command: "", stdout: "", stderr: "", results: [], error: "No supported providers selected" };
  }

  const startedAt = Date.now();
  const results: Array<{ provider: ChatProvider; ok: boolean; agent: string }> = [];
  let lastStdout = "";
  let lastStderr = "";
  let lastCommand = "";
  const providersByAgent = new Map<string, ChatProvider[]>();

  for (const provider of providers) {
    const agent = skillAgentName(provider);
    if (!agent) {
      continue;
    }
    const group = providersByAgent.get(agent) ?? [];
    group.push(provider);
    providersByAgent.set(agent, group);
  }

  for (const [agent, agentProviders] of providersByAgent.entries()) {
    const args = ["--yes", "skills@latest", "add", input.repo, "--skill", input.skillId, "--agent", agent, "--yes"];
    lastCommand = `npx ${args.join(" ")}`;
    const run = spawnSync("npx", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    lastStdout = String(run.stdout ?? "");
    lastStderr = String(run.stderr ?? "");
    const ok = run.status === 0;
    for (const provider of agentProviders) {
      results.push({ provider, ok, agent });
      recordSkillHistory({
        provider,
        repo: input.repo,
        skill_id: input.skillId,
        skill_label: input.skillId,
        status: ok ? "succeeded" : "failed",
        command: lastCommand,
        error: ok ? null : collapseWhitespace(lastStderr || lastStdout).slice(0, 1000),
        run_started_at: startedAt,
        run_completed_at: Date.now(),
        created_at: startedAt,
        updated_at: Date.now(),
      });
    }
    if (!ok) {
      return {
        ok: false,
        command: lastCommand,
        stdout: lastStdout,
        stderr: lastStderr,
        results,
        error: collapseWhitespace(lastStderr || lastStdout) || "Installation failed",
      };
    }
  }

  return { ok: true, command: lastCommand, stdout: lastStdout, stderr: lastStderr, results };
}

export function removeSkill(input: {
  skillId: string;
  providers: ChatProvider[];
}): {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  results: Array<{ provider: ChatProvider; ok: boolean; agent: string }>;
  error?: string;
} {
  const providers = Array.from(new Set(input.providers.map((provider) => normalizeSkillLearnProvider(provider)).filter(Boolean))) as ChatProvider[];
  if (providers.length === 0) {
    return { ok: false, command: "", stdout: "", stderr: "", results: [], error: "No supported providers selected" };
  }

  const startedAt = Date.now();
  const results: Array<{ provider: ChatProvider; ok: boolean; agent: string }> = [];
  let lastStdout = "";
  let lastStderr = "";
  let lastCommand = "";
  const providersByAgent = new Map<string, ChatProvider[]>();

  for (const provider of providers) {
    const agent = skillAgentName(provider);
    if (!agent) {
      continue;
    }
    const group = providersByAgent.get(agent) ?? [];
    group.push(provider);
    providersByAgent.set(agent, group);
  }

  for (const [agent, agentProviders] of providersByAgent.entries()) {
    const args = ["--yes", "skills@latest", "remove", input.skillId, "--agent", agent, "--yes"];
    lastCommand = `npx ${args.join(" ")}`;
    const run = spawnSync("npx", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    lastStdout = String(run.stdout ?? "");
    lastStderr = String(run.stderr ?? "");
    const ok = run.status === 0;
    for (const provider of agentProviders) {
      results.push({ provider, ok, agent });
      recordSkillHistory({
        provider,
        repo: "local/remove",
        skill_id: input.skillId,
        skill_label: input.skillId,
        status: ok ? "succeeded" : "failed",
        command: lastCommand,
        error: ok ? null : collapseWhitespace(lastStderr || lastStdout).slice(0, 1000),
        run_started_at: startedAt,
        run_completed_at: Date.now(),
        created_at: startedAt,
        updated_at: Date.now(),
      });
    }
    if (!ok) {
      return {
        ok: false,
        command: lastCommand,
        stdout: lastStdout,
        stderr: lastStderr,
        results,
        error: collapseWhitespace(lastStderr || lastStdout) || "Removal failed",
      };
    }
  }

  return { ok: true, command: lastCommand, stdout: lastStdout, stderr: lastStderr, results };
}

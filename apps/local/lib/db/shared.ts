import { createAdminDbClient } from "../db-adapter";
import type { SwarmModel, Task } from "./types";

export function isMissingRelationError(error: any, relation: string): boolean {
  if (!error) return false;
  const message = typeof error.message === "string" ? error.message : "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes(`relation "${relation}" does not exist`) ||
    message.includes(`Could not find the table 'agx.${relation}'`) ||
    message.includes(`Could not find the table 'public.${relation}'`)
  );
}

export function resolveTaskConfig(
  task: Task,
  stageConfig?: {
    swarm?: boolean;
    provider?: string;
    model?: string;
    swarm_models?: SwarmModel[];
  },
  userSettings?: { default_provider?: string | null; models?: Record<string, string> | null } | null
) {
  const clean = (v: any): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t : null;
  };

  let cliDefaultProvider: string | null = null;
  try {
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(process.env.HOME || "", ".agx", "config.json");
    const cliConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    cliDefaultProvider = clean(cliConfig?.defaultProvider) || null;
  } catch {
    // ~/.agx/config.json not found or unreadable
  }
  const globalDefaultProvider = clean(userSettings?.default_provider) || cliDefaultProvider || "claude";

  const provider =
    clean((task as any).provider) ||
    clean(stageConfig?.provider) ||
    globalDefaultProvider;

  const globalDefaultModel = clean(userSettings?.models?.[provider]) || null;

  const model =
    clean((task as any).model) ||
    clean(stageConfig?.model) ||
    globalDefaultModel ||
    null;

  const swarm = task.swarm ?? stageConfig?.swarm ?? false;
  const swarm_models = task.swarm_models?.length ? task.swarm_models : (stageConfig?.swarm_models || []);

  return {
    provider,
    model,
    swarm,
    swarm_models,
  };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

export async function generateUniqueSlug(base: string, db: ReturnType<typeof createAdminDbClient>): Promise<string> {
  let slug = slugify(base);
  for (let i = 0; i < 5; i++) {
    const { data, error } = await db
      .from("tasks")
      .select("id")
      .eq("slug", slug)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return slug;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slugify(base)}-${suffix}`.slice(0, 48);
  }
  return `${slugify(base)}-${Date.now().toString(36).slice(-4)}`.slice(0, 48);
}

export async function generateUniqueProjectSlug(
  base: string,
  userId: string,
  db: any,
  excludeProjectId?: string
): Promise<string> {
  let slug = slugify(base);

  for (let i = 0; i < 5; i++) {
    let query = db
      .from("projects")
      .select("id")
      .eq("slug", slug)
      .eq("user_id", userId);
    if (excludeProjectId) {
      query = query.neq("id", excludeProjectId);
    }
    const { data, error } = await query.limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return slug;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slugify(base)}-${suffix}`.slice(0, 48);
  }

  return `${slugify(base)}-${Date.now().toString(36).slice(-4)}`.slice(0, 48);
}

export function getDbClient(client?: any): any {
  return client ?? createAdminDbClient();
}

export function parseDependsOnValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // ignore parse errors
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeDependsOnInput(input?: unknown): string[] {
  if (!input) return [];
  let candidates: string[];
  if (Array.isArray(input)) {
    candidates = input.map((item) => (typeof item === "string" ? item : item === null || item === undefined ? "" : String(item))).filter(Boolean);
  } else if (typeof input === "string") {
    candidates = parseDependsOnValue(input);
  } else {
    return [];
  }
  return Array.from(new Set(candidates.map((id) => id.trim()).filter(Boolean)));
}

export function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key === "depends_on") {
        frontmatter[key] = parseDependsOnValue(value);
        continue;
      }
      if (value === "true") frontmatter[key] = true;
      else if (value === "false") frontmatter[key] = false;
      else if (/^\d+$/.test(value)) frontmatter[key] = parseInt(value, 10);
      else frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

export async function ensureNoCircularDependency(
  taskId: string,
  dependsOn: string[],
  client?: any
): Promise<void> {
  if (!taskId || !dependsOn?.length) return;
  const db = getDbClient(client);
  const visited = new Set<string>();
  const stack = [...dependsOn];

  while (stack.length) {
    const candidate = stack.pop();
    if (!candidate) continue;
    if (candidate === taskId) {
      throw new Error("Circular dependency detected");
    }
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    const { data, error } = await db
      .from("tasks")
      .select("depends_on")
      .eq("id", candidate)
      .maybeSingle();
    if (error) {
      if (error.code === "PGRST116" || error.code === "42703") continue;
      throw error;
    }
    if (!data) continue;
    const childDeps = Array.isArray(data.depends_on) ? data.depends_on : [];
    for (const next of childDeps) {
      if (next && !visited.has(next)) {
        stack.push(next);
      }
    }
  }
}

export function extractTitle(markdown: string): string | undefined {
  const { body } = parseFrontmatter(markdown);
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1] : undefined;
}


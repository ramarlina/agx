import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ActivityEvent, ActivityAction, MeshReactionType } from "./types";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

function activityPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, "activity.jsonl");
}

function ensureDir(agentId: string): void {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append an activity event (fire-and-forget, never throws) */
export function logActivity(
  agentId: string,
  action: ActivityAction,
  data?: Partial<Omit<ActivityEvent, "t" | "agent" | "action">>
): void {
  try {
    ensureDir(agentId);
    const event: ActivityEvent = {
      t: new Date().toISOString(),
      agent: agentId,
      action,
      ...data,
    };
    appendFileSync(activityPath(agentId), JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // never break the caller
  }
}

/** Read activity events, most recent first */
export function readActivity(
  agentId: string,
  options?: { limit?: number; since?: string; action?: ActivityAction }
): ActivityEvent[] {
  const path = activityPath(agentId);
  if (!existsSync(path)) return [];

  const sinceTs = options?.since ? new Date(options.since).getTime() : 0;
  const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim());
  const events: ActivityEvent[] = [];

  for (const line of lines) {
    try {
      const e: ActivityEvent = JSON.parse(line);
      if (sinceTs && new Date(e.t).getTime() < sinceTs) continue;
      if (options?.action && e.action !== options.action) continue;
      events.push(e);
    } catch {
      // skip malformed
    }
  }

  events.reverse();
  return options?.limit ? events.slice(0, options.limit) : events;
}


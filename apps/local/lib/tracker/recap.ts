import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { runCliResponse } from "@/lib/cli-runner";
import { listTrackerRuns } from "./tracker-run-store";
import type { TrackerItem } from "./types";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const LATEST_FILENAME = "latest.md";
const MAX_RETAINED = 10;

function agxHome(): string {
  return process.env.AGX_HOME ?? path.join(os.homedir(), ".agx");
}

function recapsDir(trackerType: string, itemId: string): string {
  return path.join(agxHome(), "tracker", trackerType, itemId, "recaps");
}

function timestampedName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-") + ".md";
}

export interface RecapFile {
  content: string;
  filePath: string;
  generatedAt: Date;
}

async function writeRecap(
  trackerType: string,
  itemId: string,
  content: string
): Promise<RecapFile> {
  const dir = recapsDir(trackerType, itemId);
  await fs.mkdir(dir, { recursive: true });

  const filename = timestampedName();
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, "utf8");

  const latestPath = path.join(dir, LATEST_FILENAME);
  try {
    await fs.unlink(latestPath);
  } catch {
    /* first time */
  }
  await fs.symlink(filename, latestPath);

  const entries = await fs.readdir(dir);
  const old = entries
    .filter((n) => n.endsWith(".md") && n !== LATEST_FILENAME)
    .sort()
    .reverse()
    .slice(MAX_RETAINED);
  for (const n of old) {
    try {
      await fs.unlink(path.join(dir, n));
    } catch {
      /* ignore */
    }
  }

  const stat = await fs.stat(filePath);
  return { content, filePath, generatedAt: stat.mtime };
}

export async function readLatestRecap(
  trackerType: string,
  itemId: string
): Promise<RecapFile | null> {
  const latestPath = path.join(recapsDir(trackerType, itemId), LATEST_FILENAME);
  try {
    const stat = await fs.stat(latestPath);
    const content = await fs.readFile(latestPath, "utf8");
    return { content, filePath: latestPath, generatedAt: stat.mtime };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const ITEM_RECAP_SYSTEM = [
  "You are writing a short recap of a tracker ticket.",
  "Output raw markdown only — no JSON, no fences around the whole response.",
  "Keep it 100–250 words.",
  "Cover: what the ticket is about, what's been attempted (if anything), and what's open.",
  "Write in plain prose. No headings above h3.",
].join("\n");

const GROUP_RECAP_SYSTEM = [
  "You are writing a short recap of a group of tracker tickets (e.g. a cycle or sprint).",
  "Output raw markdown only — no JSON, no fences around the whole response.",
  "Keep it 150–350 words.",
  "Cover: overall progress, what's done, what's in progress, and what's remaining.",
  "Mention individual tickets by identifier when relevant.",
  "Write in plain prose. No headings above h3.",
].join("\n");

export interface ItemContext {
  identifier: string;
  title: string;
  status: string;
  assignee?: string;
  description?: string;
  tickets?: TrackerItem[];
}

export async function generateRecap(
  trackerType: string,
  itemId: string,
  item: ItemContext
): Promise<void> {
  const isGroup = !!item.tickets;

  const priorRuns = await listTrackerRuns({
    issueId: itemId,
    trackerType,
    limit: 10,
  });
  const priorRunLines = priorRuns
    .map(
      (run) =>
        `- ${run.status}: ${run.sessionTitle ?? run.issueTitle} (${run.agentName})`
    )
    .join("\n");

  let prompt: string;

  if (isGroup && item.tickets) {
    const ticketLines = item.tickets
      .map(
        (t) =>
          `- ${t.identifier}: ${t.title} [${t.status}]${t.assignee ? ` (${t.assignee.name})` : ""}`
      )
      .join("\n");

    prompt = [
      `Group: ${item.title}`,
      "",
      `Tickets (${item.tickets.length}):`,
      ticketLines,
      "",
      priorRunLines ? `Prior sessions:\n${priorRunLines}` : "No prior sessions.",
      "",
      "Write the recap now.",
    ].join("\n");
  } else {
    prompt = [
      `Ticket: ${item.identifier} — ${item.title}`,
      `Status: ${item.status}`,
      item.assignee ? `Assignee: ${item.assignee}` : null,
      item.description ? `\nDescription:\n${item.description}` : null,
      "",
      priorRunLines ? `Prior sessions:\n${priorRunLines}` : "No prior sessions.",
      "",
      "Write the recap now.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  let output = "";
  await runCliResponse({
    provider: "claude",
    model: null,
    prompt,
    systemContext: isGroup ? GROUP_RECAP_SYSTEM : ITEM_RECAP_SYSTEM,
    onDelta: (chunk) => {
      output += chunk;
    },
  });

  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Recap generation returned empty output");
  }

  await writeRecap(trackerType, itemId, trimmed);
}

// ---------------------------------------------------------------------------
// Runner (in-memory queue, one job per item)
// ---------------------------------------------------------------------------

export type RecapJobStatus = "queued" | "running" | "failed";

export interface RecapJobState {
  status: RecapJobStatus;
  startedAt: number;
  error?: string;
}

const state = new Map<string, RecapJobState>();
const FAILURE_HOLD_MS = 60_000;

function key(trackerType: string, itemId: string): string {
  return `${trackerType}:${itemId}`;
}

async function run(
  trackerType: string,
  itemId: string,
  item: ItemContext
): Promise<void> {
  const k = key(trackerType, itemId);
  state.set(k, { status: "running", startedAt: Date.now() });
  try {
    await generateRecap(trackerType, itemId, item);
    state.delete(k);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.set(k, { status: "failed", startedAt: Date.now(), error: message });
    setTimeout(() => {
      const current = state.get(k);
      if (current?.status === "failed") state.delete(k);
    }, FAILURE_HOLD_MS);
  }
}

export function enqueueRecap(
  trackerType: string,
  itemId: string,
  item: ItemContext
): RecapJobState {
  const k = key(trackerType, itemId);
  const existing = state.get(k);
  if (existing && existing.status !== "failed") return existing;
  const next: RecapJobState = { status: "queued", startedAt: Date.now() };
  state.set(k, next);
  void Promise.resolve().then(() => run(trackerType, itemId, item));
  return next;
}

export function getRecapJob(
  trackerType: string,
  itemId: string
): RecapJobState | null {
  return state.get(key(trackerType, itemId)) ?? null;
}

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { JournalEntry } from "./types";
import { logActivity } from "./activity";

const AGENTS_DIR = join(homedir(), ".agx", "agents");

function agentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function journalPath(agentId: string): string {
  return join(agentDir(agentId), "journal.jsonl");
}

function ensureAgentDir(agentId: string): void {
  const dir = agentDir(agentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readJournalLines(agentId: string): string[] {
  const path = journalPath(agentId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
}

function parseMaxSeq(agentId: string, lines: string[]): number {
  let maxSeq = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Pick<JournalEntry, "id">;
      const [idAgent, seqRaw] = String(parsed.id || "").split(":");
      if (idAgent !== agentId) continue;
      const seq = parseInt(seqRaw || "0", 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    } catch {
      // ignore malformed lines
    }
  }
  return maxSeq;
}

function parseEntrySeq(agentId: string, entryId?: string | null): number {
  const [idAgent, seqRaw] = String(entryId || "").split(":");
  if (idAgent !== agentId) return 0;
  const seq = parseInt(seqRaw || "0", 10);
  return Number.isFinite(seq) ? seq : 0;
}

/** Get the next monotonic entry ID for an agent */
export function getNextEntryId(agentId: string): string {
  const lines = readJournalLines(agentId);
  const maxSeq = parseMaxSeq(agentId, lines);
  return `${agentId}:${maxSeq + 1}`;
}

/** Append a journal entry (atomic append) */
export function appendJournal(
  agentId: string,
  entry: Omit<JournalEntry, "id"> & { id?: string }
): JournalEntry {
  ensureAgentDir(agentId);
  // Compute ID and append in one synchronous critical section to avoid
  // duplicate IDs from split getNextEntryId()/appendJournal() call paths.
  const lines = readJournalLines(agentId);
  const maxSeq = parseMaxSeq(agentId, lines);
  const nextId = `${agentId}:${maxSeq + 1}`;
  const normalized: JournalEntry = { ...entry, id: entry.id?.trim() || nextId };
  const line = JSON.stringify(normalized) + "\n";
  appendFileSync(journalPath(agentId), line, "utf-8");
  logActivity(agentId, entry.type === "reflection" ? "reflection" : "journal-post", {
    thread: normalized.thread,
    meta: { entryId: normalized.id },
  });
  return normalized;
}

/** Read journal entries, most recent first */
export function readJournal(agentId: string, limit?: number): JournalEntry[] {
  const lines = readJournalLines(agentId);

  const entries: JournalEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  entries.reverse(); // most recent first
  return limit ? entries.slice(0, limit) : entries;
}

/** Read journal entries after a cursor, oldest first */
export function readJournalSince(
  agentId: string,
  afterEntryId?: string | null,
): JournalEntry[] {
  const lines = readJournalLines(agentId);
  const afterSeq = parseEntrySeq(agentId, afterEntryId);
  const entries: JournalEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as JournalEntry;
      if (parseEntrySeq(agentId, parsed.id) > afterSeq) {
        entries.push(parsed);
      }
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

/** Read journal entries filtered by thread */
export function readJournalByThread(
  agentId: string,
  thread: string
): JournalEntry[] {
  return readJournal(agentId).filter((e) => e.thread === thread);
}

/** Get all unique threads an agent has participated in */
export function getAgentThreads(agentId: string): string[] {
  const entries = readJournal(agentId);
  const threads = new Set<string>();
  for (const e of entries) {
    if (e.thread) threads.add(e.thread);
    if (e.threads) e.threads.forEach((t) => threads.add(t));
  }
  return [...threads];
}

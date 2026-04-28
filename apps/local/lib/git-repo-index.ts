import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export interface RepoIndexEntry {
  path: string;
  discoveredAt: number;
}

export interface RepoIndex {
  entries: RepoIndexEntry[];
  scannedAt: number;
}

export const REPO_INDEX_PATH: string = path.join(
  process.env.HOME || os.homedir(),
  ".config",
  "agx",
  "git-index.json",
);

const PRUNE_NAMES = new Set<string>([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".cache",
  "Library",
  ".Trash",
  ".git",
  ".npm",
  ".cargo",
  ".rustup",
  ".pyenv",
  ".nvm",
]);

function shouldPrune(name: string): boolean {
  if (PRUNE_NAMES.has(name)) return true;
  if (name.startsWith(".") && name !== ".config") return true;
  return false;
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(dir, ".git"));
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

export async function loadRepoIndex(): Promise<RepoIndex | null> {
  try {
    const raw = await fs.readFile(REPO_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as RepoIndex;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.entries) ||
      typeof parsed.scannedAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRepoIndex(idx: RepoIndex): Promise<void> {
  await fs.mkdir(path.dirname(REPO_INDEX_PATH), { recursive: true });
  const tmp = `${REPO_INDEX_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(idx));
  await fs.rename(tmp, REPO_INDEX_PATH);
}

export const RESCAN_TTL_MS = 24 * 60 * 60 * 1000;

let scanning: Promise<RepoIndex> | null = null;

export function isScanning(): boolean {
  return scanning !== null;
}

export async function ensureFreshRepoIndex(opts?: {
  ttlMs?: number;
  scanner?: () => Promise<RepoIndex>;
}): Promise<{ index: RepoIndex | null; scanning: boolean }> {
  const ttlMs = opts?.ttlMs ?? RESCAN_TTL_MS;
  const scanner = opts?.scanner ?? (() => scanForRepos());
  const index = await loadRepoIndex();
  const isStale = !index || Date.now() - index.scannedAt > ttlMs;

  if (isStale && !scanning) {
    const p = (async () => {
      try {
        const fresh = await scanner();
        await saveRepoIndex(fresh);
        return fresh;
      } finally {
        scanning = null;
      }
    })();
    scanning = p;
    p.catch((err) => {
      console.error("Background repo index scan failed:", err);
    });
  }

  return { index, scanning: scanning !== null };
}

export async function scanForRepos(opts?: {
  root?: string;
  maxDepth?: number;
}): Promise<RepoIndex> {
  const root = opts?.root ?? os.homedir();
  const maxDepth = opts?.maxDepth ?? 5;
  const entries: RepoIndexEntry[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (await isRepo(dir)) {
      entries.push({ path: dir, discoveredAt: Date.now() });
      return; // do not descend into a repo
    }
    if (depth === maxDepth) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      if (shouldPrune(d.name)) continue;
      await walk(path.join(dir, d.name), depth + 1);
    }
  }

  await walk(root, 0);
  return { entries, scannedAt: Date.now() };
}

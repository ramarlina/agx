import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileP = promisify(execFile);

export interface GitWorkspace {
  repoPath: string;
  kind: "worktree" | "branch";
  path?: string;
  branch: string;
  isCheckedOut: boolean;
  isCurrent: boolean;
  defaultBranch: string | null;
}

const RESULT_LIMIT = 200;

export async function getDefaultBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      repoPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    const ref = stdout.trim();
    // expected: refs/remotes/origin/<branch>
    const m = ref.match(/^refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
    // Fallback: strip "origin/" prefix if present
    if (ref.startsWith("origin/")) return ref.slice("origin/".length);
    return ref || null;
  } catch {
    return null;
  }
}

interface WorktreeEntry {
  path: string;
  branch: string; // empty when detached
}

function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = stdout.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let wtPath = "";
    let branch = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice("worktree ".length).trim();
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      }
      // "detached" => no branch; leave empty
    }
    if (wtPath) entries.push({ path: wtPath, branch });
  }
  return entries;
}

interface BranchEntry {
  name: string;
  isCurrent: boolean;
}

function parseBranchList(stdout: string): BranchEntry[] {
  const out: BranchEntry[] = [];
  const lines = stdout.split("\n");
  for (const raw of lines) {
    if (!raw) continue;
    const [name, head] = raw.split("\t");
    if (!name) continue;
    // Skip remote HEAD aliases like "origin/HEAD -> origin/main"
    if (name.includes(" -> ")) continue;
    out.push({ name, isCurrent: head === "*" });
  }
  return out;
}

async function collectFromRepo(
  repoPath: string,
  ticketIdLower: string,
  defaultBranch: string | null,
): Promise<GitWorkspace[]> {
  let worktreeStdout: string;
  let branchStdout: string;
  try {
    const wt = await execFileP("git", [
      "-C",
      repoPath,
      "worktree",
      "list",
      "--porcelain",
    ]);
    worktreeStdout = wt.stdout;
    const br = await execFileP("git", [
      "-C",
      repoPath,
      "branch",
      "--all",
      "--format=%(refname:short)\t%(HEAD)",
    ]);
    branchStdout = br.stdout;
  } catch {
    return [];
  }

  const worktrees = parseWorktreeList(worktreeStdout);
  const branches = parseBranchList(branchStdout);

  // Set of branches that are currently checked out by some worktree.
  const checkedOutBranches = new Set<string>();
  for (const w of worktrees) {
    if (w.branch) checkedOutBranches.add(w.branch);
  }

  const results: GitWorkspace[] = [];
  const emittedWorktreeBranches = new Set<string>();

  // Worktree rows first
  for (const w of worktrees) {
    const basename = path.basename(w.path);
    const matchesBranch = w.branch.toLowerCase().includes(ticketIdLower);
    const matchesPath = basename.toLowerCase().includes(ticketIdLower);
    if (!matchesBranch && !matchesPath) continue;
    results.push({
      repoPath,
      kind: "worktree",
      path: w.path,
      branch: w.branch,
      isCheckedOut: true,
      isCurrent: w.path === repoPath,
      defaultBranch,
    });
    if (w.branch) emittedWorktreeBranches.add(w.branch);
  }

  // Branch rows (excluding ones already emitted as a worktree)
  for (const b of branches) {
    if (emittedWorktreeBranches.has(b.name)) continue;
    if (!b.name.toLowerCase().includes(ticketIdLower)) continue;
    results.push({
      repoPath,
      kind: "branch",
      branch: b.name,
      isCheckedOut: checkedOutBranches.has(b.name),
      isCurrent: false,
      defaultBranch,
    });
  }

  return results;
}

export async function listMatchingWorkspaces(args: {
  repoPaths: string[];
  ticketId: string;
}): Promise<GitWorkspace[]> {
  const ticketIdLower = args.ticketId.toLowerCase();
  if (!ticketIdLower) return [];

  const out: GitWorkspace[] = [];
  for (const repoPath of args.repoPaths) {
    if (out.length >= RESULT_LIMIT) break;
    let defaultBranch: string | null = null;
    try {
      defaultBranch = await getDefaultBranch(repoPath);
    } catch {
      defaultBranch = null;
    }
    let entries: GitWorkspace[];
    try {
      entries = await collectFromRepo(repoPath, ticketIdLower, defaultBranch);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= RESULT_LIMIT) break;
      out.push(e);
    }
  }
  return out;
}

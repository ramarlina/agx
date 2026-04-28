import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Splits a single unified diff (output of `gh pr diff` or `git diff`) into per-file patches.
 * Returns a map of `path` -> patch text starting at the first `@@` hunk header.
 */
export function splitUnifiedDiffByFile(diff: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!diff) return result;

  const lines = diff.split("\n");
  let currentPath: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentPath) {
      const text = buffer.join("\n").trimEnd();
      if (text.length > 0) result.set(currentPath, text);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = line.match(/diff --git a\/(.+?) b\/(.+)$/);
      currentPath = m ? m[2] : null;
      continue;
    }
    if (!currentPath) continue;
    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("Binary files")
    ) {
      continue;
    }
    buffer.push(line);
  }
  flush();
  return result;
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitDiffResult {
  files: GitFileChange[];
  base: string;
  ref: string; // branch name OR "WORKING_TREE"
  headSha: string;
}

function mapStatusLetter(letter: string): GitFileChange["status"] {
  const c = letter.charAt(0).toUpperCase();
  switch (c) {
    case "A":
      return "added";
    case "D":
      return "removed";
    case "R":
      return "renamed";
    case "M":
      return "modified";
    default:
      return "modified";
  }
}

interface NumstatRow {
  additions: number;
  deletions: number;
  path: string;
}

function parseNumstat(stdout: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addRaw = parts[0];
    const delRaw = parts[1];
    // Path may be in parts[2], or for renames it could be a `{old => new}` form,
    // or there may be additional path columns (parts[3] = new path).
    let path: string;
    if (parts.length >= 4 && parts[2] && parts[3]) {
      // Rename form: `-\t-\told\tnew` or `1\t2\told\tnew`
      path = parts[3];
    } else {
      const raw = parts[2];
      const braceMatch = raw.match(/^(.*)\{([^{}]*)\s*=>\s*([^{}]*)\}(.*)$/);
      if (braceMatch) {
        const prefix = braceMatch[1];
        const newMid = braceMatch[3].trim();
        const suffix = braceMatch[4];
        path = `${prefix}${newMid}${suffix}`.replace(/\/\//g, "/");
      } else {
        path = raw;
      }
    }
    const additions = addRaw === "-" ? 0 : Number.parseInt(addRaw, 10) || 0;
    const deletions = delRaw === "-" ? 0 : Number.parseInt(delRaw, 10) || 0;
    rows.push({ additions, deletions, path });
  }
  return rows;
}

interface NameStatusRow {
  status: GitFileChange["status"];
  path: string;
}

function parseNameStatus(stdout: string): NameStatusRow[] {
  const rows: NameStatusRow[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const letter = parts[0];
    const status = mapStatusLetter(letter);
    // Renames: R100\told\tnew -- pull the new path
    let path: string;
    if (status === "renamed" && parts.length >= 3) {
      path = parts[2];
    } else {
      path = parts[parts.length - 1];
    }
    rows.push({ status, path });
  }
  return rows;
}

async function runGit(repoPath: string, args: string[], opts?: { maxBuffer?: number }): Promise<string> {
  const fullArgs = ["-C", repoPath, ...args];
  const { stdout } = await execFileP("git", fullArgs, {
    maxBuffer: opts?.maxBuffer ?? MAX_BUFFER,
  });
  return stdout;
}

async function buildResult(args: {
  repoPath: string;
  base: string;
  ref: string;
  numstatArgs: string[];
  nameStatusArgs: string[];
  patchArgs: string[];
  headRevParseArg: string;
}): Promise<GitDiffResult> {
  const [numstatOut, nameStatusOut, patchOut, headShaRaw] = await Promise.all([
    runGit(args.repoPath, args.numstatArgs),
    runGit(args.repoPath, args.nameStatusArgs),
    runGit(args.repoPath, args.patchArgs),
    runGit(args.repoPath, ["rev-parse", args.headRevParseArg]),
  ]);

  const numstat = parseNumstat(numstatOut);
  const nameStatus = parseNameStatus(nameStatusOut);
  const patches = splitUnifiedDiffByFile(patchOut);

  // Join by path. Use nameStatus order as canonical.
  const numByPath = new Map<string, NumstatRow>();
  for (const row of numstat) numByPath.set(row.path, row);

  const files: GitFileChange[] = nameStatus.map((row) => {
    const num = numByPath.get(row.path);
    return {
      path: row.path,
      status: row.status,
      additions: num?.additions ?? 0,
      deletions: num?.deletions ?? 0,
      patch: patches.get(row.path) ?? null,
    };
  });

  return {
    files,
    base: args.base,
    ref: args.ref,
    headSha: headShaRaw.trim(),
  };
}

export async function diffBranch(args: {
  repoPath: string;
  base: string;
  ref: string;
}): Promise<GitDiffResult> {
  const range = `${args.base}...${args.ref}`;
  return buildResult({
    repoPath: args.repoPath,
    base: args.base,
    ref: args.ref,
    numstatArgs: ["diff", "--numstat", range],
    nameStatusArgs: ["diff", "--name-status", range],
    patchArgs: ["diff", range],
    headRevParseArg: args.ref,
  });
}

export async function diffWorkingTree(args: {
  repoPath: string;
  base: string;
}): Promise<GitDiffResult> {
  return buildResult({
    repoPath: args.repoPath,
    base: args.base,
    ref: "WORKING_TREE",
    numstatArgs: ["diff", "--numstat", args.base],
    nameStatusArgs: ["diff", "--name-status", args.base],
    patchArgs: ["diff", args.base],
    headRevParseArg: "HEAD",
  });
}

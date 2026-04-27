import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GithubPr,
  GithubPrFile,
  GithubPrComment,
} from "./github-types";

const execFileP = promisify(execFile);

const VIEW_FIELDS = [
  "number",
  "title",
  "body",
  "state",
  "isDraft",
  "author",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "url",
  "additions",
  "deletions",
  "changedFiles",
  "labels",
  "assignees",
  "reviewRequests",
  "createdAt",
  "updatedAt",
  "mergedAt",
  "closedAt",
  "statusCheckRollup",
  "reviewDecision",
  "files",
].join(",");

interface GhView {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  author: { login: string } | null;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: { name: string }[];
  assignees: { login: string }[];
  reviewRequests: { login?: string; name?: string }[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  statusCheckRollup: { conclusion?: string; status?: string }[];
  reviewDecision: string;
  files: { path: string; additions: number; deletions: number; changeType: string }[];
}

function parseRepoId(repoId: string): { owner: string; name: string; number: number } | null {
  const m = repoId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2], number: Number(m[3]) };
}

function epoch(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function ciStatusFromRollup(rollup: GhView["statusCheckRollup"]): GithubPr["ciStatus"] {
  if (!rollup || rollup.length === 0) return null;
  const concs = rollup.map((c) => (c.conclusion || c.status || "").toLowerCase());
  if (concs.some((c) => c === "failure" || c === "error" || c === "cancelled" || c === "timed_out")) return "failure";
  if (concs.some((c) => c === "" || c === "in_progress" || c === "queued" || c === "pending")) return "pending";
  if (concs.every((c) => c === "success" || c === "neutral" || c === "skipped")) return "success";
  return "pending";
}

function reviewDecisionFromGh(d: string): GithubPr["reviewDecision"] {
  switch (d) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return null;
  }
}

function stateFromGh(s: string, mergedAt: string | null): GithubPr["state"] {
  if (mergedAt) return "merged";
  switch (s.toUpperCase()) {
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    case "MERGED":
      return "merged";
    default:
      return "open";
  }
}

/**
 * Splits a single unified diff (output of `gh pr diff`) into per-file patches.
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

interface FetchResult {
  pr: GithubPr;
  files: GithubPrFile[];
  comments: GithubPrComment[];
}

/**
 * Fetches a PR via `gh` CLI. Returns null when the PR cannot be resolved.
 * Throws when `gh` is missing or returns a non-zero exit for an unknown reason.
 */
export async function fetchPrViaGh(prId: string): Promise<FetchResult | null> {
  const parsed = parseRepoId(prId);
  if (!parsed) return null;
  const repoSlug = `${parsed.owner}/${parsed.name}`;
  const numberStr = String(parsed.number);

  let viewRaw: string;
  try {
    const { stdout } = await execFileP("gh", [
      "pr",
      "view",
      numberStr,
      "--repo",
      repoSlug,
      "--json",
      VIEW_FIELDS,
    ]);
    viewRaw = stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/could not resolve|not found/i.test(msg)) return null;
    throw err;
  }

  const view = JSON.parse(viewRaw) as GhView;

  const { stdout: diffRaw } = await execFileP(
    "gh",
    ["pr", "diff", numberStr, "--repo", repoSlug],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const patches = splitUnifiedDiffByFile(diffRaw);

  const now = Date.now();
  const pr: GithubPr = {
    id: prId,
    repoId: repoSlug,
    number: view.number,
    title: view.title,
    body: view.body,
    state: stateFromGh(view.state, view.mergedAt),
    draft: !!view.isDraft,
    authorLogin: view.author?.login ?? "",
    headRef: view.headRefName,
    headSha: view.headRefOid,
    baseRef: view.baseRefName,
    url: view.url,
    ciStatus: ciStatusFromRollup(view.statusCheckRollup ?? []),
    reviewDecision: reviewDecisionFromGh(view.reviewDecision),
    assignees: (view.assignees ?? []).map((a) => a.login),
    reviewers: (view.reviewRequests ?? []).map((r) => ({
      login: r.login ?? r.name ?? "",
      state: "pending",
    })),
    labels: (view.labels ?? []).map((l) => l.name),
    createdAt: epoch(view.createdAt) ?? now,
    updatedAt: epoch(view.updatedAt) ?? now,
    mergedAt: epoch(view.mergedAt),
    closedAt: epoch(view.closedAt),
    lastSyncedAt: now,
  };

  const files: GithubPrFile[] = (view.files ?? []).map((f) => ({
    prId,
    path: f.path,
    status: f.changeType.toLowerCase(),
    additions: f.additions,
    deletions: f.deletions,
    changes: f.additions + f.deletions,
    patch: patches.get(f.path) ?? null,
    lastSyncedAt: now,
  }));

  return { pr, files, comments: [] };
}

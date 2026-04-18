import type {
  GithubPr,
  GithubPrComment,
  GithubPrFile,
  GithubIssue,
  GithubTokens,
  GithubReviewer,
  GithubCiStatus,
  GithubReviewDecision,
} from "./github-types";

export class GithubAuthError extends Error {
  constructor(message = "github auth failed") {
    super(message);
    this.name = "GithubAuthError";
  }
}

export class GithubRateLimitError extends Error {
  constructor(public resetAt: number) {
    super("github rate limited");
    this.name = "GithubRateLimitError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GithubClientInit {
  tokens: GithubTokens;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
}

interface RawPull {
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  assignees?: Array<{ login: string }>;
  requested_reviewers?: Array<{ login: string }>;
  labels?: Array<{ name: string }>;
}

interface RawIssueComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

interface RawReviewComment extends RawIssueComment {
  path: string;
  line: number | null;
}

function toEpoch(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : 0;
}

function mapReviewers(list: RawPull["requested_reviewers"]): GithubReviewer[] {
  return (list ?? []).map((r) => ({ login: r.login, state: "pending" as const }));
}

function mapPr(owner: string, name: string, raw: RawPull, syncedAt: number): GithubPr {
  const merged = raw.merged_at != null;
  const closed = raw.closed_at != null;
  const state: GithubPr["state"] = merged ? "merged" : closed ? "closed" : "open";
  return {
    id: `${owner}/${name}#${raw.number}`,
    repoId: `${owner}/${name}`,
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    state,
    draft: Boolean(raw.draft),
    authorLogin: raw.user?.login ?? "",
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    url: raw.html_url,
    ciStatus: null,
    reviewDecision: null,
    assignees: (raw.assignees ?? []).map((a) => a.login),
    reviewers: mapReviewers(raw.requested_reviewers),
    labels: (raw.labels ?? []).map((l) => l.name),
    createdAt: toEpoch(raw.created_at),
    updatedAt: toEpoch(raw.updated_at),
    mergedAt: merged ? toEpoch(raw.merged_at) : null,
    closedAt: closed ? toEpoch(raw.closed_at) : null,
    lastSyncedAt: syncedAt,
  };
}

export class GithubClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly tokens: GithubTokens;
  private readonly userAgent: string;

  constructor(init: GithubClientInit) {
    this.tokens = init.tokens;
    this.fetchImpl = init.fetchImpl ?? ((url, opts) => fetch(url, opts));
    this.baseUrl = init.baseUrl ?? "https://api.github.com";
    this.userAgent = init.userAgent ?? "agx-github-client";
  }

  private async request<T>(pathname: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "User-Agent": this.userAgent,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 401) throw new GithubAuthError();
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000;
        throw new GithubRateLimitError(reset);
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`github ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async listPullRequests(input: {
    owner: string;
    name: string;
    state?: "all" | "open" | "closed";
    perPage?: number;
  }): Promise<GithubPr[]> {
    const params = new URLSearchParams({
      state: input.state ?? "all",
      sort: "updated",
      direction: "desc",
      per_page: String(input.perPage ?? 50),
    });
    const raw = await this.request<RawPull[]>(
      `/repos/${input.owner}/${input.name}/pulls?${params}`,
    );
    const now = Date.now();
    return raw.map((r) => mapPr(input.owner, input.name, r, now));
  }

  async getCombinedStatus(input: {
    owner: string;
    name: string;
    sha: string;
  }): Promise<GithubCiStatus> {
    const data = await this.request<{
      check_runs?: Array<{
        status: string;
        conclusion: string | null;
      }>;
    }>(`/repos/${input.owner}/${input.name}/commits/${input.sha}/check-runs`);
    const runs = data.check_runs ?? [];
    if (runs.length === 0) return null;
    if (runs.some((r) => r.status !== "completed")) return "pending";
    const failConclusions = new Set([
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
    ]);
    if (runs.some((r) => r.conclusion && failConclusions.has(r.conclusion))) {
      return "failure";
    }
    if (runs.some((r) => r.conclusion === "success")) return "success";
    return null;
  }

  async getReviewDecision(input: {
    owner: string;
    name: string;
    number: number;
  }): Promise<GithubReviewDecision> {
    const reviews = await this.request<
      Array<{
        state: string;
        user: { login: string } | null;
        submitted_at: string | null;
      }>
    >(`/repos/${input.owner}/${input.name}/pulls/${input.number}/reviews`);
    const latestByUser = new Map<string, { state: string; at: number }>();
    for (const r of reviews) {
      const login = r.user?.login;
      if (!login) continue;
      if (
        r.state === "DISMISSED" ||
        r.state === "PENDING" ||
        r.state === "COMMENTED"
      ) {
        continue;
      }
      const at = toEpoch(r.submitted_at);
      const existing = latestByUser.get(login);
      if (!existing || at >= existing.at) {
        latestByUser.set(login, { state: r.state, at });
      }
    }
    const states = [...latestByUser.values()].map((v) => v.state);
    if (states.length === 0) return "review_required";
    if (states.some((s) => s === "CHANGES_REQUESTED")) return "changes_requested";
    if (states.some((s) => s === "APPROVED")) return "approved";
    return "review_required";
  }

  async enrichPrStatus(pr: GithubPr): Promise<GithubPr> {
    const [owner, name] = pr.repoId.split("/");
    if (!owner || !name) return pr;
    const [ciStatus, reviewDecision] = await Promise.all([
      this.getCombinedStatus({ owner, name, sha: pr.headSha }),
      this.getReviewDecision({ owner, name, number: pr.number }),
    ]);
    return { ...pr, ciStatus, reviewDecision };
  }

  async listIssues(input: {
    owner: string;
    name: string;
    state?: "all" | "open" | "closed";
    perPage?: number;
  }): Promise<GithubIssue[]> {
    const params = new URLSearchParams({
      state: input.state ?? "all",
      sort: "updated",
      direction: "desc",
      per_page: String(input.perPage ?? 50),
    });
    // Note: GitHub's issues endpoint returns both issues and PRs; filter PRs out
    const raw = await this.request<
      Array<{
        number: number;
        title: string | null;
        body: string | null;
        state: string;
        closed_at: string | null;
        created_at: string;
        updated_at: string;
        user: { login: string } | null;
        html_url: string;
        assignees?: Array<{ login: string }>;
        labels?: Array<{ name: string } | string>;
        pull_request?: unknown;
      }>
    >(`/repos/${input.owner}/${input.name}/issues?${params}`);
    const now = Date.now();
    return raw
      .filter((r) => !r.pull_request)
      .map((r) => ({
        id: `${input.owner}/${input.name}!${r.number}`,
        repoId: `${input.owner}/${input.name}`,
        number: r.number,
        title: r.title ?? "",
        body: r.body ?? "",
        state: (r.state === "closed" ? "closed" : "open") as GithubIssue["state"],
        authorLogin: r.user?.login ?? "",
        url: r.html_url,
        assignees: (r.assignees ?? []).map((a) => a.login),
        labels: (r.labels ?? []).map((l) =>
          typeof l === "string" ? l : l.name,
        ),
        createdAt: toEpoch(r.created_at),
        updatedAt: toEpoch(r.updated_at),
        closedAt: r.closed_at ? toEpoch(r.closed_at) : null,
        lastSyncedAt: now,
      }));
  }

  async listPullRequestFiles(input: {
    owner: string;
    name: string;
    number: number;
    perPage?: number;
  }): Promise<GithubPrFile[]> {
    const prId = `${input.owner}/${input.name}#${input.number}`;
    const params = new URLSearchParams({
      per_page: String(input.perPage ?? 100),
    });
    const raw = await this.request<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
      }>
    >(`/repos/${input.owner}/${input.name}/pulls/${input.number}/files?${params}`);
    const now = Date.now();
    return raw.map((r) => ({
      prId,
      path: r.filename,
      status: r.status,
      additions: r.additions ?? 0,
      deletions: r.deletions ?? 0,
      changes: r.changes ?? 0,
      patch: r.patch ?? null,
      lastSyncedAt: now,
    }));
  }

  async listPullRequestComments(input: {
    owner: string;
    name: string;
    number: number;
  }): Promise<GithubPrComment[]> {
    const prId = `${input.owner}/${input.name}#${input.number}`;
    const [issueComments, reviewComments] = await Promise.all([
      this.request<RawIssueComment[]>(
        `/repos/${input.owner}/${input.name}/issues/${input.number}/comments`,
      ),
      this.request<RawReviewComment[]>(
        `/repos/${input.owner}/${input.name}/pulls/${input.number}/comments`,
      ),
    ]);
    const mapped: GithubPrComment[] = [];
    for (const c of issueComments) {
      mapped.push({
        id: String(c.id),
        prId,
        kind: "issue_comment",
        authorLogin: c.user?.login ?? "",
        body: c.body ?? "",
        path: null,
        line: null,
        createdAt: toEpoch(c.created_at),
        updatedAt: toEpoch(c.updated_at),
      });
    }
    for (const c of reviewComments) {
      mapped.push({
        id: String(c.id),
        prId,
        kind: "review_comment",
        authorLogin: c.user?.login ?? "",
        body: c.body ?? "",
        path: c.path ?? null,
        line: c.line ?? null,
        createdAt: toEpoch(c.created_at),
        updatedAt: toEpoch(c.updated_at),
      });
    }
    return mapped;
  }
}

export interface RefreshTokensInput {
  refreshToken: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

export async function refreshGithubTokens(
  input: RefreshTokensInput,
): Promise<GithubTokens> {
  const fetchImpl = input.fetchImpl ?? ((url, opts) => fetch(url, opts));
  const endpoint = input.endpoint ?? "https://www.runagx.com/api/github/refresh";
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: input.refreshToken }),
  });
  if (!res.ok) throw new GithubAuthError(`refresh failed ${res.status}`);
  return (await res.json()) as GithubTokens;
}

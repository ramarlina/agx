// GitHub tracker adapter — registers GitHub as a tracker so it appears in
// the Connect picker alongside Linear and Jira. GitHub isn't a classic
// issue-board tracker; data methods return empty / throw since the
// post-connect UI shows a repo manager instead of an issue board.

import type { TrackerAdapter } from "../../tracker-adapter";
import type {
  TrackerItem,
  TrackerItemDetail,
  TrackerFilters,
  TrackerItemUpdate,
  TrackerGroup,
  TrackerStatusOption,
  TrackerAssignee,
  TrackerActivity,
  ConnectionStatus,
  TokenResult,
  PaginatedResult,
} from "../../types";
import {
  loadGithubTokens,
  saveGithubTokens,
  clearGithubTokens,
} from "@/lib/github-token-store";
import { consumeOAuthSession, createOAuthSession } from "@/lib/github-oauth-sessions";
import { getConfiguredAppBaseUrl } from "@/lib/app-config";
import { listGithubRepos } from "@/lib/github-repo-store";
import { listGithubPrs } from "@/lib/github-pr-store";
import { listGithubIssuesByRepo, listAllGithubIssues } from "@/lib/github-issue-store";
import type { GithubIssue, GithubPr } from "@/lib/github-types";
import { GitHubIcon } from "./github-icon";
export { GitHubIcon } from "./github-icon";

function prToTrackerItem(pr: GithubPr): TrackerItem {
  const statusCategory: TrackerItem["statusCategory"] =
    pr.state === "merged"
      ? "done"
      : pr.state === "closed"
        ? "cancelled"
        : pr.draft
          ? "todo"
          : "in_progress";
  const identifier = `PR #${pr.number}`;
  return {
    id: pr.id,
    trackerId: pr.id,
    trackerType: "github",
    identifier,
    title: pr.title,
    description: pr.body,
    status: pr.draft ? "draft" : pr.state,
    statusCategory,
    assignee: pr.authorLogin
      ? { id: pr.authorLogin, name: pr.authorLogin }
      : undefined,
    labels: ["pr", ...pr.labels],
    createdAt: new Date(pr.createdAt).toISOString(),
    updatedAt: new Date(pr.updatedAt).toISOString(),
    url: pr.url,
    group: { id: pr.repoId, name: pr.repoId },
  };
}

function issueToTrackerItem(issue: GithubIssue): TrackerItem {
  const statusCategory: TrackerItem["statusCategory"] =
    issue.state === "closed" ? "done" : "todo";
  const identifier = `#${issue.number}`;
  return {
    id: issue.id,
    trackerId: issue.id,
    trackerType: "github",
    identifier,
    title: issue.title,
    description: issue.body,
    status: issue.state,
    statusCategory,
    assignee: issue.authorLogin
      ? { id: issue.authorLogin, name: issue.authorLogin }
      : undefined,
    labels: ["issue", ...issue.labels],
    createdAt: new Date(issue.createdAt).toISOString(),
    updatedAt: new Date(issue.updatedAt).toISOString(),
    url: issue.url,
    group: { id: issue.repoId, name: issue.repoId },
  };
}

const CONNECT_BASE_URL = "https://www.runagx.com/connect/github";

export class GitHubAdapter implements TrackerAdapter {
  type = "github" as const;
  displayName = "GitHub";
  icon = GitHubIcon;
  groupLabel = "Repo";

  getAuthUrl(projectId: string): string {
    const session = createOAuthSession(projectId);
    const appUrl = getConfiguredAppBaseUrl();
    const port = new URL(appUrl).port || process.env.PORT || "3000";
    const returnUrl = `http://localhost:${port}/api/trackers/github/token-receive`;

    const url = new URL(CONNECT_BASE_URL);
    url.searchParams.set("session", session);
    url.searchParams.set("return", returnUrl);
    url.searchParams.set("project", projectId);
    return url.toString();
  }

  async handleCallback(_projectId: string, _code: string): Promise<TokenResult> {
    throw new Error("GitHub uses token delivery, not code exchange");
  }

  async handleTokenDelivery(
    projectId: string,
    params: Record<string, string>,
  ): Promise<void> {
    const sessionToken = params.session?.trim();
    const accessToken = params.access_token?.trim();
    const refreshToken = params.refresh_token;
    const expiresAtRaw = params.expires_at;
    const login = params.login?.trim();
    const scopesRaw = params.scopes ?? "";

    if (!sessionToken) throw new Error("Missing session");
    const session = consumeOAuthSession(sessionToken);
    if (!session) throw new Error("Invalid or expired session");
    if (session.projectId !== projectId) {
      throw new Error("Session project mismatch");
    }
    if (!accessToken) throw new Error("Missing access_token");
    if (!login) throw new Error("Missing login");

    const expiresAt =
      expiresAtRaw && expiresAtRaw !== "" && !Number.isNaN(Number(expiresAtRaw))
        ? Number(expiresAtRaw)
        : null;

    const scopes = scopesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    saveGithubTokens(projectId, {
      accessToken,
      refreshToken: refreshToken && refreshToken.length > 0 ? refreshToken : null,
      expiresAt,
      login,
      scopes,
    });
  }

  async getStatus(projectId: string): Promise<ConnectionStatus> {
    const tokens = loadGithubTokens(projectId);
    if (!tokens) return { connected: false };
    return {
      connected: true,
      user: { id: tokens.login, name: tokens.login },
    };
  }

  async disconnect(projectId: string): Promise<void> {
    clearGithubTokens(projectId);
    const { removeTrackerConnection } = await import("../../connections");
    removeTrackerConnection(projectId, "github");
  }

  // ── Data methods: GitHub is not an issue-board tracker in this app. ─
  // Mirror Jira's conservative pattern — return empty / throw clearly.

  async listItems(
    _projectId: string,
    filters: TrackerFilters,
  ): Promise<PaginatedResult<TrackerItem>> {
    const repoIds = filters.groupIds && filters.groupIds.length > 0 ? filters.groupIds : null;
    const prs: GithubPr[] = repoIds
      ? repoIds.flatMap((repoId) => listGithubPrs({ repoId }))
      : listGithubPrs({});
    const issues: GithubIssue[] = repoIds
      ? repoIds.flatMap((repoId) => listGithubIssuesByRepo(repoId))
      : listAllGithubIssues();
    const items = [
      ...prs.map(prToTrackerItem),
      ...issues.map(issueToTrackerItem),
    ].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return {
      items,
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  async getItem(_projectId: string, _itemId: string): Promise<TrackerItemDetail> {
    throw new Error("GitHub adapter does not support issue items");
  }

  async updateItem(
    _projectId: string,
    _itemId: string,
    _update: TrackerItemUpdate,
  ): Promise<TrackerItem> {
    throw new Error("GitHub adapter does not support issue updates");
  }

  async addComment(
    _projectId: string,
    _itemId: string,
    _body: string,
  ): Promise<void> {
    throw new Error("GitHub adapter does not support comments");
  }

  async getActivity(
    _projectId: string,
    _itemId: string,
  ): Promise<TrackerActivity[]> {
    return [];
  }

  async listGroups(_projectId: string): Promise<TrackerGroup[]> {
    const repos = listGithubRepos();
    return repos.map((r) => ({ id: r.id, name: r.name, type: "repo" }));
  }

  async listStatuses(_projectId: string): Promise<TrackerStatusOption[]> {
    return [
      { id: "open", name: "Open", category: "todo" },
      { id: "in_progress", name: "Open PR", category: "in_progress" },
      { id: "draft", name: "Draft", category: "todo" },
      { id: "merged", name: "Merged", category: "done" },
      { id: "closed", name: "Closed", category: "cancelled" },
    ];
  }

  async listAssignees(_projectId: string): Promise<TrackerAssignee[]> {
    return [];
  }

  async handleApiKeyConnect(projectId: string, apiKey: string): Promise<void> {
    const token = apiKey.trim();
    if (!token) throw new Error("Personal Access Token is required");

    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 401) {
      throw new Error("Invalid Personal Access Token");
    }
    if (res.status === 403) {
      throw new Error("Token lacks required permissions or is rate-limited");
    }
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status})`);
    }

    const user = (await res.json()) as { login?: string };
    if (!user.login) {
      throw new Error("Could not read user login from GitHub");
    }

    const scopeHeader = res.headers.get("x-oauth-scopes") ?? "";
    const scopes = scopeHeader
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    saveGithubTokens(projectId, {
      accessToken: token,
      refreshToken: null,
      expiresAt: null,
      login: user.login,
      scopes,
    });
  }
}

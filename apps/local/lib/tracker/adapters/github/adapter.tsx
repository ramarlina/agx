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
import { GitHubIcon } from "./github-icon";
export { GitHubIcon } from "./github-icon";

const CONNECT_BASE_URL = "https://www.runagx.com/connect/github";

export class GitHubAdapter implements TrackerAdapter {
  type = "github" as const;
  displayName = "GitHub";
  icon = GitHubIcon;

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
    _filters: TrackerFilters,
  ): Promise<PaginatedResult<TrackerItem>> {
    return { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
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
    return [];
  }

  async listStatuses(_projectId: string): Promise<TrackerStatusOption[]> {
    return [];
  }

  async listAssignees(_projectId: string): Promise<TrackerAssignee[]> {
    return [];
  }

  async handleApiKeyConnect(_projectId: string, _apiKey: string): Promise<void> {
    throw new Error(
      "GitHub requires OAuth authentication — use the Connect button instead",
    );
  }
}

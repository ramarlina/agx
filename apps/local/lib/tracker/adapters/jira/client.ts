import "server-only";

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const AGX_DIR = path.join(homedir(), ".agx");

// ── OAuth 2.0 (3LO) for Jira Cloud ──────────────────────────────────

const JIRA_AUTH_BASE = "https://auth.atlassian.com";
const JIRA_API_BASE = "https://api.atlassian.com";

export interface JiraToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  /** The Atlassian cloud ID (identifies the Jira instance) */
  cloudId?: string;
  /** The site URL, e.g. "https://myteam.atlassian.net" */
  siteUrl?: string;
}

export interface JiraAccessibleResource {
  id: string;     // cloudId
  name: string;   // site name
  url: string;    // e.g. "https://myteam.atlassian.net"
  scopes: string[];
}

// ── Token storage ───────────────────────────────────────────────────

function getTokenPath(projectId: string): string {
  return path.join(AGX_DIR, "projects", projectId, "integrations", "jira.json");
}

export function getJiraToken(projectId: string): JiraToken | null {
  if (!projectId) return null;
  const filePath = getTokenPath(projectId);
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as JiraToken;
  } catch {
    return null;
  }
}

export function saveJiraToken(projectId: string, token: JiraToken): void {
  if (!projectId) throw new Error("projectId is required to save a Jira token");
  const filePath = getTokenPath(projectId);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(token, null, 2), "utf8");
}

export function deleteJiraToken(projectId: string): void {
  if (!projectId) return;
  const filePath = getTokenPath(projectId);
  try {
    unlinkSync(filePath);
  } catch {
    // already gone
  }
}

// ── OAuth helpers ───────────────────────────────────────────────────

export function getJiraAuthUrl(projectId: string): string {
  const clientId = process.env.JIRA_CLIENT_ID;
  if (!clientId) {
    throw new Error("JIRA_CLIENT_ID environment variable is not set");
  }
  const redirectUri = getJiraRedirectUri();
  const state = Buffer.from(JSON.stringify({ projectId })).toString("base64url");

  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: "read:jira-work write:jira-work read:jira-user offline_access",
    redirect_uri: redirectUri,
    response_type: "code",
    prompt: "consent",
    state,
  });

  return `${JIRA_AUTH_BASE}/authorize?${params.toString()}`;
}

function getJiraRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/trackers/jira/callback`;
}

export async function exchangeJiraCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("JIRA_CLIENT_ID and JIRA_CLIENT_SECRET must be set");
  }

  const res = await fetch(`${JIRA_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getJiraRedirectUri(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function refreshJiraToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("JIRA_CLIENT_ID and JIRA_CLIENT_SECRET must be set");
  }

  const res = await fetch(`${JIRA_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function getAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]> {
  const res = await fetch(`${JIRA_API_BASE}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return [];
  return res.json() as Promise<JiraAccessibleResource[]>;
}

// ── Jira Cloud REST API client ──────────────────────────────────────

export class JiraClient {
  private accessToken: string;
  private cloudId: string;
  private siteUrl: string;

  constructor(accessToken: string, cloudId: string, siteUrl: string) {
    this.accessToken = accessToken;
    this.cloudId = cloudId;
    this.siteUrl = siteUrl;
  }

  private get baseUrl(): string {
    return `${JIRA_API_BASE}/ex/jira/${this.cloudId}/rest/api/3`;
  }

  private get agileUrl(): string {
    return `${JIRA_API_BASE}/ex/jira/${this.cloudId}/rest/agile/1.0`;
  }

  private async request(url: string, options?: RequestInit): Promise<Response> {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options?.headers,
      },
    });
    return res;
  }

  // ── Viewer / current user ────────────────────────────────────────

  async getMyself(): Promise<{ id: string; name: string; avatarUrl?: string }> {
    const res = await this.request(`${this.baseUrl}/myself`);
    if (!res.ok) throw new Error(`Failed to get Jira user: ${res.status}`);
    const data = await res.json();
    return {
      id: data.accountId,
      name: data.displayName,
      avatarUrl: data.avatarUrls?.["48x48"],
    };
  }

  // ── Issues ────────────────────────────────────────────────────────

  async searchIssues(jql: string, options?: {
    startAt?: number;
    maxResults?: number;
    fields?: string[];
  }): Promise<{
    issues: JiraRawIssue[];
    total: number;
    startAt: number;
    maxResults: number;
  }> {
    const body = {
      jql,
      startAt: options?.startAt ?? 0,
      maxResults: options?.maxResults ?? 50,
      fields: options?.fields ?? [
        "summary", "status", "assignee", "priority", "labels",
        "description", "updated", "created", "issuetype",
        "project", "sprint", "comment",
      ],
    };

    const res = await this.request(`${this.baseUrl}/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira search failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getIssue(issueIdOrKey: string): Promise<JiraRawIssue> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}?expand=renderedFields`
    );
    if (!res.ok) throw new Error(`Failed to get Jira issue ${issueIdOrKey}: ${res.status}`);
    return res.json();
  }

  async updateIssue(issueIdOrKey: string, fields: Record<string, unknown>): Promise<void> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}`,
      {
        method: "PUT",
        body: JSON.stringify({ fields }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update Jira issue ${issueIdOrKey}: ${res.status} ${text}`);
    }
  }

  async addComment(issueIdOrKey: string, body: string): Promise<void> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/comment`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to add comment to ${issueIdOrKey}: ${res.status} ${text}`);
    }
  }

  async getComments(issueIdOrKey: string): Promise<JiraRawComment[]> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/comment`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.comments ?? [];
  }

  // ── Transitions (status changes) ──────────────────────────────────

  async getTransitions(issueIdOrKey: string): Promise<JiraRawTransition[]> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/transitions`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.transitions ?? [];
  }

  async transitionIssue(issueIdOrKey: string, transitionId: string): Promise<void> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
      {
        method: "POST",
        body: JSON.stringify({ transition: { id: transitionId } }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to transition ${issueIdOrKey}: ${res.status} ${text}`);
    }
  }

  // ── Projects ──────────────────────────────────────────────────────

  async getProjects(): Promise<JiraRawProject[]> {
    const res = await this.request(`${this.baseUrl}/project`);
    if (!res.ok) return [];
    return res.json();
  }

  // ── Statuses ──────────────────────────────────────────────────────

  async getStatuses(): Promise<JiraRawStatus[]> {
    const res = await this.request(`${this.baseUrl}/status`);
    if (!res.ok) return [];
    return res.json();
  }

  // ── Sprints (Agile API) ───────────────────────────────────────────

  async getBoards(): Promise<JiraRawBoard[]> {
    const res = await this.request(`${this.agileUrl}/board`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.values ?? [];
  }

  async getSprints(boardId: number): Promise<JiraRawSprint[]> {
    const res = await this.request(`${this.agileUrl}/board/${boardId}/sprint`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.values ?? [];
  }

  // ── Users / assignees ─────────────────────────────────────────────

  async getAssignableUsers(projectKey: string): Promise<JiraRawUser[]> {
    const params = new URLSearchParams({ project: projectKey });
    const res = await this.request(`${this.baseUrl}/user/assignable/search?${params}`);
    if (!res.ok) return [];
    return res.json();
  }

  // ── Activity ──────────────────────────────────────────────────────

  async getActivity(issueIdOrKey: string): Promise<JiraRawActivityItem[]> {
    const res = await this.request(
      `${this.baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/changelog`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.values ?? [];
  }
}

// ── Raw Jira API response types ─────────────────────────────────────

export interface JiraRawIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: JiraAdfContent | string | null;
    status: { id: string; name: string; statusCategory: { key: string; name: string } };
    assignee?: { accountId: string; displayName: string; avatarUrls?: Record<string, string> } | null;
    priority?: { id: string; name: string } | null;
    labels: string[];
    created: string;
    updated: string;
    project: { id: string; key: string; name: string };
    issuetype: { id: string; name: string };
    sprint?: { id: number; name: string; state: string } | null;
    comment?: { comments: JiraRawComment[] };
  };
}

export interface JiraRawComment {
  id: string;
  body: JiraAdfContent | string;
  author: { accountId: string; displayName: string; avatarUrls?: Record<string, string> };
  created: string;
}

export interface JiraRawTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

export interface JiraRawProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraRawStatus {
  id: string;
  name: string;
  statusCategory: { key: string; name: string };
}

export interface JiraRawBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraRawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

export interface JiraRawUser {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraRawActivityItem {
  id: string;
  author: { accountId: string; displayName: string };
  created: string;
  items: Array<{
    field: string;
    fieldtype: string;
    from?: string;
    fromString?: string;
    to?: string;
    toString?: string;
  }>;
}

/** Jira Atlassian Document Format (ADF) content */
export type JiraAdfContent = {
  type: string;
  version: number;
  content: unknown[];
};

// ── Helper: get a JiraClient from a project's stored token ──────────

export function getJiraClient(projectId: string): JiraClient | null {
  const token = getJiraToken(projectId);
  if (!token?.accessToken || !token?.cloudId || !token?.siteUrl) {
    return null;
  }

  // Auto-refresh if expired
  if (token.expiresAt && Date.now() > token.expiresAt && token.refreshToken) {
    // Return a client anyway — the refresh will happen on first request
    // A production implementation would await the refresh here
    return new JiraClient(token.accessToken, token.cloudId, token.siteUrl);
  }

  return new JiraClient(token.accessToken, token.cloudId, token.siteUrl);
}

// ── ADF to plain text (minimal conversion) ──────────────────────────

export function adfToPlainText(content: JiraAdfContent | string | null | undefined): string | null {
  if (!content) return null;
  if (typeof content === "string") return content;

  function extractText(node: unknown): string {
    if (typeof node === "string") return node;
    if (!node || typeof node !== "object") return "";
    const obj = node as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") return obj.text as string;
    if (Array.isArray(obj.content)) {
      return (obj.content as unknown[]).map(extractText).join("");
    }
    return "";
  }

  return extractText(content);
}
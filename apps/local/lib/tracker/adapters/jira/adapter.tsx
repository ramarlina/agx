import type { TrackerAdapter, McpServerConfig } from "../../tracker-adapter";
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
  getJiraClient,
  getJiraToken,
  getJiraAuthUrl,
  exchangeJiraCode,
  getAccessibleResources,
  saveJiraToken,
  deleteJiraToken,
} from "./client";
import { jiraStatusCategoryToCanonical } from "./issues";

// ── JiraIcon component ──────────────────────────────────────────────

export function JiraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M94.6 12.2c-1.4-1.6-3.4-2.5-5.6-2.5H10.8c-2.1 0-4.1.9-5.6 2.5C3.8 13.8 3 15.8 3 17.9v64.2c0 2.1.8 4.1 2.2 5.7 1.5 1.6 3.5 2.5 5.6 2.5h78.2c2.2 0 4.2-.9 5.6-2.5 1.5-1.6 2.2-3.6 2.2-5.7V17.9c.1-2.1-.6-4.1-2.2-5.7zM50 72.4L27.6 50 50 27.6 72.4 50 50 72.4z" />
    </svg>
  );
}

// ── JiraAdapter ─────────────────────────────────────────────────────

export class JiraAdapter implements TrackerAdapter {
  type = "jira" as const;
  displayName = "Jira Cloud";
  icon = JiraIcon;

  getAuthUrl(projectId: string): string {
    return getJiraAuthUrl(projectId);
  }

  async handleCallback(projectId: string, code: string): Promise<TokenResult> {
    // Exchange the code for tokens
    const tokenResult = await exchangeJiraCode(code);

    // Get accessible resources (cloudId + siteUrl)
    const resources = await getAccessibleResources(tokenResult.accessToken);
    const primary = resources[0]; // Use the first accessible Jira instance

    if (!primary) {
      throw new Error("No accessible Jira resources found");
    }

    // Store the full token with cloudId and siteUrl
    saveJiraToken(projectId, {
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      expiresAt: tokenResult.expiresAt,
      cloudId: primary.id,
      siteUrl: primary.url,
    });

    return {
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      expiresAt: tokenResult.expiresAt,
    };
  }

  async getStatus(projectId: string): Promise<ConnectionStatus> {
    const token = getJiraToken(projectId);
    if (!token?.accessToken || !token?.cloudId) {
      return { connected: false };
    }

    try {
      const client = getJiraClient(projectId);
      if (!client) return { connected: false };

      const myself = await client.getMyself();
      return {
        connected: true,
        user: {
          id: myself.id,
          name: myself.name,
          avatarUrl: myself.avatarUrl,
        },
      };
    } catch {
      return { connected: false };
    }
  }

  async disconnect(projectId: string): Promise<void> {
    deleteJiraToken(projectId);
    const { removeTrackerConnection } = await import("../../connections");
    removeTrackerConnection(projectId, "jira");
  }

  async listItems(projectId: string, filters: TrackerFilters): Promise<PaginatedResult<TrackerItem>> {
    const { ensureJiraIssueCache, mapJiraIssue } = await import("./issues");
    const token = getJiraToken(projectId);

    // Ensure cache is populated
    await ensureJiraIssueCache({ projectId });

    // Query the cache with tracker-agnostic filters
    const { listCachedTrackerItems } = await import("../../tracker-item-store");
    const result = await listCachedTrackerItems({
      trackerType: "jira",
      search: filters.search,
      statuses: filters.statuses,
      statusCategories: filters.statusCategories,
      assigneeIds: filters.assigneeIds,
      groupIds: filters.groupIds, // sprints for Jira
      cursor: filters.cursor,
      limit: filters.limit,
      sortBy: filters.sortBy ?? "activity",
      sortDir: filters.sortDir,
      hasActivity: filters.hasActivity,
    });

    const siteUrl = token?.siteUrl ?? "https://example.atlassian.net";

    return {
      items: result.issues.map((issue) => ({
        id: issue.id,
        trackerId: issue.trackerId || "jira:default",
        trackerType: "jira",
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        status: issue.status,
        statusCategory: issue.statusCategory,
        assignee: issue.assignee
          ? { id: issue.assigneeId ?? issue.assignee, name: issue.assignee }
          : undefined,
        labels: issue.labels ?? [],
        createdAt: issue.pulledAt,
        updatedAt: issue.updatedAt,
        url: issue.url ?? `${siteUrl}/browse/${issue.identifier}`,
      })),
      pageInfo: result.pageInfo,
    };
  }

  async getItem(projectId: string, itemId: string): Promise<TrackerItemDetail> {
    const { getJiraIssueDetail } = await import("./issues");
    return getJiraIssueDetail(projectId, itemId);
  }

  async updateItem(projectId: string, itemId: string, update: TrackerItemUpdate): Promise<TrackerItem> {
    const client = getJiraClient(projectId);
    if (!client) throw new Error("Not connected to Jira");

    if (update.status) {
      // Find the transition that leads to the target status
      const transitions = await client.getTransitions(itemId);
      const target = transitions.find((t) => t.to.name === update.status || t.name === update.status);

      if (target) {
        await client.transitionIssue(itemId, target.id);
      } else {
        // Fallback: try updating the status field directly
        await client.updateIssue(itemId, { status: update.status });
      }

      // Refresh the item after update
      const token = getJiraToken(projectId);
      const siteUrl = token?.siteUrl ?? "https://example.atlassian.net";
      const updatedIssue = await client.getIssue(itemId);
      const { mapJiraIssue } = await import("./issues");
      return mapJiraIssue(updatedIssue, siteUrl);
    }

    if (update.assigneeId) {
      await client.updateIssue(itemId, { assignee: { accountId: update.assigneeId } });
    }

    if (update.labels) {
      await client.updateIssue(itemId, { labels: update.labels });
    }

    // Return the updated item
    const token = getJiraToken(projectId);
    const siteUrl = token?.siteUrl ?? "https://example.atlassian.net";
    const updatedIssue = await client.getIssue(itemId);
    const { mapJiraIssue } = await import("./issues");
    return mapJiraIssue(updatedIssue, siteUrl);
  }

  async addComment(projectId: string, itemId: string, body: string): Promise<void> {
    const client = getJiraClient(projectId);
    if (!client) throw new Error("Not connected to Jira");
    await client.addComment(itemId, body);
  }

  async getActivity(projectId: string, itemId: string): Promise<TrackerActivity[]> {
    const client = getJiraClient(projectId);
    if (!client) return [];

    const rawActivity = await client.getActivity(itemId);
    return rawActivity.map((a) => ({
      id: a.id,
      type: "update",
      description: a.items
        .map((i) => `${i.field}: ${i.fromString ?? ""} → ${i.toString ?? ""}`)
        .join(", "),
      actor: { id: a.author.accountId, name: a.author.displayName },
      createdAt: a.created,
    }));
  }

  async listGroups(projectId: string): Promise<TrackerGroup[]> {
    const client = getJiraClient(projectId);
    if (!client) return [];

    try {
      const boards = await client.getBoards();
      const groups: TrackerGroup[] = [];

      for (const board of boards.slice(0, 5)) {
        const sprints = await client.getSprints(board.id);
        for (const sprint of sprints) {
          if (sprint.state === "active" || sprint.state === "future") {
            groups.push({
              id: String(sprint.id),
              name: sprint.name,
              type: "sprint",
            });
          }
        }
      }

      return groups;
    } catch {
      return [];
    }
  }

  async listStatuses(projectId: string): Promise<TrackerStatusOption[]> {
    const client = getJiraClient(projectId);
    if (!client) return [];

    try {
      const statuses = await client.getStatuses();
      return statuses.map((s) => ({
        id: s.id,
        name: s.name,
        category: jiraStatusCategoryToCanonical(s.statusCategory?.key),
      }));
    } catch {
      return [];
    }
  }

  async listAssignees(projectId: string): Promise<TrackerAssignee[]> {
    const client = getJiraClient(projectId);
    if (!client) return [];

    const token = getJiraToken(projectId);
    // Try to get the project key from cached items
    const { listCachedTrackerItems } = await import("../../tracker-item-store");
    const items = await listCachedTrackerItems({ trackerType: "jira", limit: 1 });
    const projectKey = items.issues[0]?.teamKey;

    if (!projectKey) return [];

    try {
      const users = await client.getAssignableUsers(projectKey);
      return users.map((u) => ({
        id: u.accountId,
        name: u.displayName,
        avatarUrl: u.avatarUrls?.["48x48"],
      }));
    } catch {
      return [];
    }
  }

  getMcpConfig(_projectId: string): McpServerConfig {
    // Atlassian MCP server for Jira
    return {
      name: "jira",
      command: "npx",
      args: ["-y", "@anthropic-ai/atlassian-mcp"],
      env: {},
    };
  }

  renderGroupLabel(group: TrackerGroup): string {
    if (group.type === "sprint") return `Sprint: ${group.name}`;
    return group.name;
  }
}
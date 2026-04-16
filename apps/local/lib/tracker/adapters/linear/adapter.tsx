// Linear tracker adapter — implements TrackerAdapter by wrapping the
// existing Linear GraphQL client and issue cache.

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
  TrackerStatusCategory,
} from "../../types";
import { getLinearClient } from "./client";
import type { LinearCycle } from "./client";

// Linear status → statusCategory mapping
function linearStatusToCategory(status: string): TrackerStatusCategory {
  const lower = status.trim().toLowerCase();
  if (["done", "completed", "closed"].includes(lower)) return "done";
  if (["cancelled", "canceled", "duplicate"].includes(lower)) return "cancelled";
  if (["in progress", "in review", "started", "testing", "deployed", "in deployment"].includes(lower)) return "in_progress";
  return "todo";
}

// Auth helpers
function getLinearAuthUrl(projectId: string): string {
  const port = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).port || "3000"
    : "3000";
  return `https://www.runagx.com/integrations/linear/auth?port=${port}`;
}

async function handleLinearCallback(_projectId: string, _code: string): Promise<TokenResult> {
  // Actual token exchange is handled by the route handler which has access
  // to cookies and env vars. This method is a placeholder for the interface.
  throw new Error("Linear OAuth callback must be handled by the route handler");
}

async function getLinearConnectionStatus(projectId: string): Promise<ConnectionStatus> {
  const client = getLinearClient(projectId);
  if (!client) {
    return { connected: false };
  }
  try {
    const viewer = await client.viewer;
    return {
      connected: true,
      user: { id: viewer.id, name: viewer.name, avatarUrl: undefined },
    };
  } catch {
    return { connected: false };
  }
}

async function disconnectLinear(projectId: string): Promise<void> {
  const { deleteProjectTicketToken } = await import("./client");
  deleteProjectTicketToken(projectId, "linear");
}

// Cycle → TrackerGroup mapping
function cycleToGroup(cycle: LinearCycle): TrackerGroup {
  return {
    id: cycle.id,
    name: cycle.name ?? `Cycle ${cycle.number}`,
    type: "cycle",
  };
}

// LinearIcon component
export function LinearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2.4 62.4C1.2 58.2.4 53.8.4 49.2.4 38 5 28 12.4 20.8l4.8 4.8C11.2 31.6 7.2 39.8 7.2 49.2c0 3.8.6 7.4 1.6 10.8L2.4 62.4zM20.8 12.4C28 5 38 .4 49.2.4c4.6 0 9 .8 13.2 2l-2.4 6.4C56.8 7.8 53.2 7.2 49.2 7.2c-9.4 0-17.6 4-23.6 10L20.8 12.4zM87.6 20.8C95 28 99.6 38 99.6 49.2c0 4.6-.8 9-2 13.2l-6.4-2.4c1-3.4 1.6-7 1.6-10.8 0-9.4-4-17.6-10-23.6l4.8-4.8zM37.6 62.4C34 58.8 31.6 54 31.6 49.2c0-9.6 7.8-17.6 17.6-17.6 4.8 0 9.2 2 12.8 5.2l-4.4 5.2C55.2 39.8 52.2 38 49.2 38c-6.2 0-11.2 5-11.2 11.2 0 3 1.2 5.8 3 8l-3.4 5.2z" />
    </svg>
  );
}

export class LinearAdapter implements TrackerAdapter {
  type = "linear" as const;
  displayName = "Linear";
  icon = LinearIcon;

  getAuthUrl(projectId: string): string {
    return getLinearAuthUrl(projectId);
  }

  async handleCallback(projectId: string, code: string): Promise<TokenResult> {
    return handleLinearCallback(projectId, code);
  }

  async getStatus(projectId: string): Promise<ConnectionStatus> {
    return getLinearConnectionStatus(projectId);
  }

  async disconnect(projectId: string): Promise<void> {
    return disconnectLinear(projectId);
  }

  async listItems(projectId: string, filters: TrackerFilters): Promise<PaginatedResult<TrackerItem>> {
    const { ensureLinearIssueCache, listLinearIssueSummaries } = await import("./issues");
    const { getIssueActivityMap } = await import("../../tracker-run-store");

    // Ensure cache is populated
    const shouldRefresh = !filters.cursor;
    await ensureLinearIssueCache({ projectId, refresh: shouldRefresh });

    // Build the cache query from tracker-agnostic filters
    const activityMap = filters.hasActivity
      ? await getIssueActivityMap(projectId)
      : undefined;

    // Map statusCategories to raw status names (we query the cache which stores raw statuses)
    const { listCachedTrackerItems } = await import("../../tracker-item-store");
    const result = await listCachedTrackerItems({
      trackerType: "linear",
      search: filters.search,
      statusCategories: filters.statusCategories,
      assigneeIds: filters.assigneeIds,
      groupIds: filters.groupIds, // cycles for Linear
      cursor: filters.cursor,
      limit: filters.limit,
      sortBy: "activity",
      activityMap,
    });

    return {
      items: result.issues.map((issue) => ({
        id: issue.id,
        trackerId: issue.trackerId || `linear:${issue.teamId ?? "default"}`,
        trackerType: "linear",
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        status: issue.status,
        statusCategory: issue.statusCategory,
        assignee: issue.assignee
          ? { id: issue.assigneeId ?? issue.assignee, name: issue.assignee, avatarUrl: undefined }
          : undefined,
        priority: undefined,
        labels: issue.labels ?? [],
        createdAt: issue.pulledAt,
        updatedAt: issue.updatedAt,
        url: issue.url ?? `https://linear.app/issue/${issue.identifier}`,
      })),
      pageInfo: result.pageInfo,
    };
  }

  async getItem(projectId: string, itemId: string): Promise<TrackerItemDetail> {
    const { getCachedTrackerItemContexts } = await import("../../tracker-item-store");
    const contexts = await getCachedTrackerItemContexts([itemId]);
    const issue = contexts[0];
    if (!issue) {
      throw new Error(`Item ${itemId} not found`);
    }

    return {
      id: issue.id,
      trackerId: issue.trackerId || `linear:${issue.teamId ?? "default"}`,
      trackerType: "linear",
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      status: issue.status,
      statusCategory: issue.statusCategory,
      assignee: issue.assignee
        ? { id: issue.assigneeId ?? issue.assignee, name: issue.assignee, avatarUrl: undefined }
        : undefined,
      labels: issue.labels ?? [],
      createdAt: issue.pulledAt,
      updatedAt: issue.updatedAt,
      url: issue.url ?? `https://linear.app/issue/${issue.identifier}`,
      comments: [], // Comments require Linear API call — populated on demand
      activity: [], // Activity requires Linear API call — populated on demand
      metadata: {
        teamId: issue.teamId,
        teamName: issue.teamName,
        teamKey: issue.teamKey,
        cycleId: issue.cycleId,
        cycleName: issue.cycleName,
        cycleNumber: issue.cycleNumber,
        isAssignedToMe: issue.isAssignedToMe,
      },
    };
  }

  async updateItem(projectId: string, itemId: string, update: TrackerItemUpdate): Promise<TrackerItem> {
    const client = getLinearClient(projectId);
    if (!client) throw new Error("Not connected to Linear");

    if (update.status) {
      const result = await client.updateIssueStatus(itemId, update.status);
      // Update the cache
      const { updateCachedTrackerItemStatus } = await import("../../tracker-item-store");
      await updateCachedTrackerItemStatus({
        issueId: itemId,
        status: result.status ?? update.status,
        updatedAt: result.updatedAt,
      });

      return {
        id: itemId,
        trackerId: `linear:default`,
        trackerType: "linear",
        identifier: result.identifier,
        title: result.title,
        status: result.status ?? update.status,
        statusCategory: linearStatusToCategory(result.status ?? update.status),
        assignee: result.assignee ? { id: result.assignee, name: result.assignee } : undefined,
        labels: [],
        createdAt: result.updatedAt,
        updatedAt: result.updatedAt,
        url: result.url ?? `https://linear.app/issue/${result.identifier}`,
      };
    }

    throw new Error("Only status updates are currently supported");
  }

  async addComment(projectId: string, itemId: string, body: string): Promise<void> {
    // Linear comment API not yet in client — would need GraphQL mutation
    throw new Error("Linear addComment not yet implemented");
  }

  async getActivity(projectId: string, itemId: string): Promise<TrackerActivity[]> {
    // Linear activity API not yet in client — would need GraphQL query
    return [];
  }

  async listGroups(projectId: string): Promise<TrackerGroup[]> {
    const client = getLinearClient(projectId);
    if (!client) return [];
    const cycles = await client.cycles();
    return cycles.map(cycleToGroup);
  }

  async listStatuses(projectId: string): Promise<TrackerStatusOption[]> {
    // Return common Linear statuses — a full implementation would
    // fetch team-specific statuses from the GraphQL API
    return [
      { id: "todo", name: "Todo", category: "todo" },
      { id: "in_progress", name: "In Progress", category: "in_progress" },
      { id: "done", name: "Done", category: "done" },
      { id: "cancelled", name: "Cancelled", category: "cancelled" },
    ];
  }

  async listAssignees(projectId: string): Promise<TrackerAssignee[]> {
    const client = getLinearClient(projectId);
    if (!client) return [];
    const users = await client.users();
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      avatarUrl: undefined,
    }));
  }

  getMcpConfig(_projectId: string): McpServerConfig {
    return {
      name: "linear",
      command: "npx",
      args: ["-y", "@anthropic-ai/linear-mcp"],
      env: {},
    };
  }

  renderGroupLabel(group: TrackerGroup): string {
    if (group.type === "cycle") return `Cycle: ${group.name}`;
    return group.name;
  }
}
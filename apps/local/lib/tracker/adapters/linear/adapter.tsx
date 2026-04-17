// Linear tracker adapter — implements TrackerAdapter by wrapping the
// existing Linear GraphQL client and issue cache.

import type { TrackerAdapter, McpServerConfig } from "../../tracker-adapter";
import { getConfiguredAppBaseUrl } from "@/lib/app-config";
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
import { getLinearClient, getProjectTicketToken } from "./client";
import type { LinearCycle } from "./client";
import { LinearIcon } from "./linear-icon";
export { LinearIcon } from "./linear-icon";

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
  const appUrl = getConfiguredAppBaseUrl();
  const port = new URL(appUrl).port || "41741";
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

export class LinearAdapter implements TrackerAdapter {
  type = "linear" as const;
  displayName = "Linear";
  groupLabel = "Cycle";
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
      statuses: filters.statuses,
      statusCategories: filters.statusCategories,
      assigneeIds: filters.assigneeIds,
      groupIds: filters.groupIds, // cycles for Linear
      cursor: filters.cursor,
      limit: filters.limit,
      sortBy: filters.sortBy ?? "activity",
      sortDir: filters.sortDir,
      hasActivity: filters.hasActivity,
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
    const client = getLinearClient(projectId);
    if (!client) return [];

    try {
      const states = await client.workflowStates();
      const seen = new Set<string>();
      return states
        .map((s) => ({
          id: s.id,
          name: s.name,
          category: linearStatusToCategory(s.name),
        }))
        .filter((s) => {
          if (seen.has(s.name)) return false;
          seen.add(s.name);
          return true;
        });
    } catch {
      return [
        { id: "todo", name: "Todo", category: "todo" },
        { id: "in_progress", name: "In Progress", category: "in_progress" },
        { id: "done", name: "Done", category: "done" },
        { id: "cancelled", name: "Cancelled", category: "cancelled" },
      ];
    }
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

  async handleApiKeyConnect(projectId: string, apiKey: string): Promise<void> {
    const { saveProjectTicketToken } = await import("./client");
    saveProjectTicketToken(projectId, "linear", { accessToken: apiKey });
  }

  async handleTokenDelivery(projectId: string, params: Record<string, string>): Promise<void> {
    const accessToken = params.access_token;
    if (!accessToken) throw new Error("Missing access_token");
    const { saveProjectTicketToken } = await import("./client");
    const expiresIn = params.expires_in ? Number(params.expires_in) : undefined;
    saveProjectTicketToken(projectId, "linear", {
      accessToken,
      ...(expiresIn && { expiresAt: Date.now() + expiresIn * 1000 }),
    });
  }

  getMcpConfig(projectId: string): McpServerConfig {
    const token = getProjectTicketToken(projectId, "linear");
    return {
      name: "linear",
      url: "https://mcp.linear.app/sse",
      headers: token ? { Authorization: `Bearer ${token.accessToken}` } : {},
    };
  }

  renderGroupLabel(group: TrackerGroup): string {
    if (group.type === "cycle") return `Cycle: ${group.name}`;
    return group.name;
  }
}
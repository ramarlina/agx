/**
 * Canonical tracker data types. All UI components, filters, and storage
 * work off these shapes — never raw tracker-specific fields.
 *
 * Each tracker adapter maps its native fields into these types so the
 * rest of the app stays tracker-agnostic.
 */

export type TrackerStatusCategory = "todo" | "in_progress" | "done" | "cancelled";

export interface TrackerItem {
  id: string;
  trackerId: string;
  trackerType: string;
  identifier: string;
  title: string;
  description?: string;
  status: string;
  statusCategory: TrackerStatusCategory;
  assignee?: { id: string; name: string; avatarUrl?: string };
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  labels: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  /** The tracker-native group this item belongs to (e.g. GitHub repo). */
  group?: { id: string; name: string };
}

export interface TrackerItemDetail extends TrackerItem {
  comments: TrackerComment[];
  activity: TrackerActivity[];
  metadata: Record<string, unknown>;
}

export interface TrackerGroup {
  id: string;
  name: string;
  type: string; // 'cycle' | 'sprint' | 'inbox' | 'tag' | ...
}

export interface TrackerComment {
  id: string;
  body: string;
  author: { id: string; name: string; avatarUrl?: string };
  createdAt: string;
}

export interface TrackerActivity {
  id: string;
  type: string;
  description: string;
  actor?: { id: string; name: string };
  createdAt: string;
}

export interface TrackerFilters {
  statuses?: string[];
  statusCategories?: TrackerStatusCategory[];
  assigneeIds?: string[];
  labels?: string[];
  groupIds?: string[];
  search?: string;
  cursor?: string;
  limit?: number;
  sortBy?: "activity" | "identifier" | "status" | "created";
  sortDir?: "asc" | "desc";
  /** When true, only return items with recent activity */
  hasActivity?: boolean;
  /** Map of item_id -> ISO timestamp for activity-based sorting */
  activityMap?: Map<string, string>;
}

export interface TrackerItemUpdate {
  status?: string;
  assigneeId?: string;
  priority?: string;
  labels?: string[];
}

export interface TrackerStatusOption {
  id: string;
  name: string;
  category: TrackerStatusCategory;
}

export interface TrackerAssignee {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  user?: { id: string; name: string; avatarUrl?: string };
  mcpConfigured?: Record<string, boolean>;
}

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface TrackerConnection {
  type: string;
  connectedAt: string;
  /** Tracker-specific data, e.g. Jira's cloudId/siteUrl */
  metadata?: Record<string, string>;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export type TrackerRunMode = "chat" | "scripted";
export type TrackerRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
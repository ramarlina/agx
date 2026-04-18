// Tracker module barrel export.
// Importing this file registers all built-in adapters.

import { registerAdapter } from "./registry";
import { LinearAdapter } from "./adapters/linear";
import { JiraAdapter } from "./adapters/jira";
import { GitHubAdapter } from "./adapters/github";

// Register all built-in adapters
const linearAdapter = new LinearAdapter();
registerAdapter(linearAdapter);

const jiraAdapter = new JiraAdapter();
registerAdapter(jiraAdapter);

const githubAdapter = new GitHubAdapter();
registerAdapter(githubAdapter);

// Re-export public API
export { getAdapter, getAdapterOrNull, listAdapterTypes, listAdapters } from "./registry";
export { listTrackerConnections, addTrackerConnection, removeTrackerConnection } from "./connections";
export type { TrackerAdapter, McpServerConfig } from "./tracker-adapter";
export type {
  TrackerItem,
  TrackerItemDetail,
  TrackerGroup,
  TrackerComment,
  TrackerActivity,
  TrackerStatusCategory,
  TrackerFilters,
  TrackerItemUpdate,
  TrackerStatusOption,
  TrackerAssignee,
  ConnectionStatus,
  TokenResult,
  TrackerConnection,
  PaginatedResult,
  TrackerRunMode,
  TrackerRunStatus,
} from "./types";
export type { TrackerRunRecord, IssueActiveAgent } from "./tracker-run-store";
export type {
  CachedTrackerItemRecord,
  CachedTrackerItemInput,
  TrackerItemSyncState,
  ListCachedTrackerItemsInput,
  ListCachedTrackerItemsResult,
} from "./tracker-item-store";
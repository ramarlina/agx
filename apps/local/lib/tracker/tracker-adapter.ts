import type { ComponentType } from "react";
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
} from "./types";

export interface McpServerConfig {
  name: string;
  // stdio command style
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // remote SSE style
  url?: string;
  headers?: Record<string, string>;
}

export interface TrackerAdapter {
  /** Unique identifier for this tracker type, e.g. 'linear' or 'jira' */
  type: string;
  /** Human-readable name, e.g. 'Linear' or 'Jira Cloud' */
  displayName: string;
  /** Icon component to render in the sidebar and headers */
  icon: ComponentType<{ className?: string }>;

  // Auth
  getAuthUrl(projectId: string): string;
  handleCallback(projectId: string, code: string): Promise<TokenResult>;
  getStatus(projectId: string): Promise<ConnectionStatus>;
  disconnect(projectId: string): Promise<void>;

  // Items (mandatory)
  listItems(projectId: string, filters: TrackerFilters): Promise<PaginatedResult<TrackerItem>>;
  getItem(projectId: string, itemId: string): Promise<TrackerItemDetail>;
  updateItem(projectId: string, itemId: string, update: TrackerItemUpdate): Promise<TrackerItem>;
  addComment(projectId: string, itemId: string, body: string): Promise<void>;
  getActivity(projectId: string, itemId: string): Promise<TrackerActivity[]>;

  // Grouping (optional — return empty arrays if not supported)
  listGroups(projectId: string): Promise<TrackerGroup[]>;
  listStatuses(projectId: string): Promise<TrackerStatusOption[]>;
  listAssignees(projectId: string): Promise<TrackerAssignee[]>;

  // API-key connect (optional — adapters that only support OAuth can throw)
  handleApiKeyConnect?(projectId: string, apiKey: string): Promise<void>;

  // Token delivery from external OAuth broker (e.g. agx-web)
  handleTokenDelivery?(projectId: string, params: Record<string, string>): Promise<void>;

  // MCP (optional)
  getMcpConfig?(projectId: string): McpServerConfig;

  // UI customization (optional)
  renderGroupLabel?(group: TrackerGroup): string;
}
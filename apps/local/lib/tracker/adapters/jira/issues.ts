import "server-only";

import {
  getJiraClient,
  getJiraToken,
  type JiraRawIssue,
  adfToPlainText,
} from "./client";
import type {
  TrackerItem,
  TrackerItemDetail,
  TrackerComment,
  TrackerActivity,
  TrackerStatusCategory,
} from "../../types";
import {
  replaceCachedTrackerItems,
  listCachedTrackerItems,
  getCachedTrackerItemContexts,
  type CachedTrackerItemInput,
} from "../../tracker-item-store";

// ── Jira statusCategory → canonical statusCategory ──────────────────

export function jiraStatusCategoryToCanonical(key: string): TrackerStatusCategory {
  switch (key) {
    case "new":
      return "todo";
    case "indeterminate":
      return "in_progress";
    case "done":
      return "done";
    default:
      return "todo";
  }
}

// ── Jira priority → canonical priority ──────────────────────────────

function jiraPriorityToCanonical(name: string | null | undefined): TrackerItem["priority"] {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower.includes("highest") || lower.includes("critical")) return "urgent";
  if (lower.includes("high")) return "high";
  if (lower.includes("medium") || lower.includes("major")) return "medium";
  if (lower.includes("low") || lower.includes("minor")) return "low";
  if (lower.includes("lowest") || lower.includes("trivial")) return "low";
  return "none";
}

// ── Map a raw Jira issue to a canonical TrackerItem ─────────────────

export function mapJiraIssue(
  issue: JiraRawIssue,
  siteUrl: string,
  accountId?: string,
): TrackerItem {
  const fields = issue.fields;
  const statusCategoryKey = fields.status?.statusCategory?.key ?? "new";

  return {
    id: issue.id,
    trackerId: `jira:${fields.project?.key ?? "unknown"}`,
    trackerType: "jira",
    identifier: issue.key,
    title: fields.summary,
    description: adfToPlainText(fields.description) ?? undefined,
    status: fields.status?.name ?? "Unknown",
    statusCategory: jiraStatusCategoryToCanonical(statusCategoryKey),
    assignee: fields.assignee
      ? {
          id: fields.assignee.accountId,
          name: fields.assignee.displayName,
          avatarUrl: fields.assignee.avatarUrls?.["48x48"],
        }
      : undefined,
    priority: jiraPriorityToCanonical(fields.priority?.name),
    labels: fields.labels ?? [],
    createdAt: fields.created,
    updatedAt: fields.updated,
    url: `${siteUrl}/browse/${issue.key}`,
  };
}

// ── Map a raw Jira issue to a cache input ────────────────────────────

function mapJiraIssueToCacheInput(
  issue: JiraRawIssue,
  siteUrl: string,
): CachedTrackerItemInput {
  const fields = issue.fields;
  const statusCategoryKey = fields.status?.statusCategory?.key ?? "new";

  return {
    id: issue.id,
    trackerType: "jira",
    trackerId: `jira:${fields.project?.key ?? "unknown"}`,
    identifier: issue.key,
    title: fields.summary,
    description: adfToPlainText(fields.description),
    status: fields.status?.name ?? "Unknown",
    statusCategory: jiraStatusCategoryToCanonical(statusCategoryKey),
    assigneeId: fields.assignee?.accountId ?? null,
    assignee: fields.assignee?.displayName ?? null,
    assigneeEmail: null,
    isAssignedToMe: false, // Set later when we know the viewer
    teamId: fields.project?.id ?? null,
    teamName: fields.project?.name ?? null,
    teamKey: fields.project?.key ?? null,
    cycleId: fields.customfield_10020 ? String(fields.customfield_10020.id) : null,
    cycleName: fields.customfield_10020?.name ?? null,
    cycleNumber: fields.customfield_10020 ? fields.customfield_10020.id : null,
    priority: fields.priority?.name ?? null,
    labels: fields.labels ?? [],
    url: `${siteUrl}/browse/${issue.key}`,
    updatedAt: fields.updated,
  };
}

// ── Pull Jira issues and cache them ─────────────────────────────────

export async function pullJiraIssues(input: {
  projectId: string;
  projectKey?: string;
  jql?: string;
  limit?: number;
}): Promise<{ pulled: number }> {
  const client = await getJiraClient(input.projectId);
  if (!client) throw new Error("Not connected to Jira");

  const token = getJiraToken(input.projectId);
  if (!token?.siteUrl) throw new Error("Missing Jira site URL");

  const jql = input.jql ?? (input.projectKey
    ? `project = ${input.projectKey} ORDER BY updated DESC`
    : "assignee = currentUser() OR reporter = currentUser() ORDER BY updated DESC");
  const limit = input.limit ?? 100;
  const allIssues: CachedTrackerItemInput[] = [];
  let nextPageToken: string | undefined;
  let isLast = false;

  while (!isLast && allIssues.length < limit) {
    const result = await client.searchIssues(jql, {
      nextPageToken,
      maxResults: Math.min(50, limit - allIssues.length),
    });

    for (const issue of result.issues) {
      allIssues.push(mapJiraIssueToCacheInput(issue, token.siteUrl));
    }

    isLast = result.isLast || result.issues.length === 0;
    nextPageToken = result.nextPageToken;
  }

  await replaceCachedTrackerItems({
    trackerType: "jira",
    issues: allIssues,
    complete: isLast,
    pulledAtMs: Date.now(),
  });

  return { pulled: allIssues.length };
}

// ── Ensure cache is populated, refresh if needed ────────────────────

export async function ensureJiraIssueCache(input: {
  projectId: string;
  refresh?: boolean;
  projectKey?: string;
}): Promise<{ pulledAt: string | null }> {
  const { getTrackerItemSyncState, setTrackerItemSyncState } = await import("../../tracker-item-store");

  const syncState = await getTrackerItemSyncState("jira");
  const shouldRefresh = input.refresh || !syncState?.lastPulledAt;

  if (shouldRefresh) {
    await pullJiraIssues({
      projectId: input.projectId,
      projectKey: input.projectKey,
    });
    await setTrackerItemSyncState("jira", 0, Date.now());
  }

  return { pulledAt: syncState?.lastPulledAt ?? null };
}

// ── List cached Jira issue summaries ────────────────────────────────

export async function listJiraIssueSummaries(input?: {
  limit?: number;
}): Promise<{ issues: TrackerItem[] }> {
  const result = await listCachedTrackerItems({
    trackerType: "jira",
    limit: input?.limit ?? 500,
  });

  return {
    issues: result.issues.map((issue) => ({
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
      priority: undefined,
      labels: issue.labels ?? [],
      createdAt: issue.pulledAt,
      updatedAt: issue.updatedAt,
      url: issue.url ?? "#",
    })),
  };
}

// ── Get detail for a single Jira issue ──────────────────────────────

export async function getJiraIssueDetail(
  projectId: string,
  issueIdOrKey: string,
): Promise<TrackerItemDetail> {
  const client = await getJiraClient(projectId);
  if (!client) throw new Error("Not connected to Jira");

  const token = getJiraToken(projectId);
  const siteUrl = token?.siteUrl ?? "https://example.atlassian.net";

  const rawIssue = await client.getIssue(issueIdOrKey);
  const item = mapJiraIssue(rawIssue, siteUrl);

  // Get comments
  const rawComments = rawIssue.fields.comment?.comments ?? [];
  const comments: TrackerComment[] = rawComments.map((c) => ({
    id: c.id,
    body: typeof c.body === "string" ? c.body : adfToPlainText(c.body) ?? "",
    author: { id: c.author.accountId, name: c.author.displayName },
    createdAt: c.created,
  }));

  // Get activity
  const rawActivity = await client.getActivity(issueIdOrKey);
  const activity: TrackerActivity[] = rawActivity.map((a) => ({
    id: a.id,
    type: "update",
    description: a.items.map((i) => `${i.field}: ${i.fromString ?? ""} → ${i.toString ?? ""}`).join(", "),
    actor: { id: a.author.accountId, name: a.author.displayName },
    createdAt: a.created,
  }));

  return {
    ...item,
    comments,
    activity,
    metadata: {
      projectId: rawIssue.fields.project?.id,
      projectKey: rawIssue.fields.project?.key,
      projectName: rawIssue.fields.project?.name,
      issueType: rawIssue.fields.issuetype?.name,
      sprintId: rawIssue.fields.customfield_10020?.id,
      sprintName: rawIssue.fields.customfield_10020?.name,
    },
  };
}
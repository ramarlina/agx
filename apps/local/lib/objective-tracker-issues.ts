// Tracker-agnostic objective issue helpers.
// Inlined from the deleted objective-linear-issues.ts with canonical
// tracker-agnostic names.

import "server-only";

import {
  ensureLinearIssueCache,
  listLinearIssueSummaries,
  type LinearIssueSummary,
} from "@/lib/linear-issues";

export type ObjectiveTrackerIssueSummary = LinearIssueSummary;

const OBJECTIVE_TRACKER_TERMINAL_STATUSES = new Set([
  "done",
  "cancelled",
  "canceled",
  "duplicate",
]);

export function matchesObjectiveLabel(label: string, objectiveKey: string): boolean {
  return label.trim().toLowerCase() === objectiveKey.trim().toLowerCase();
}

export function isObjectiveTrackerTerminalStatus(status: string | null | undefined): boolean {
  return OBJECTIVE_TRACKER_TERMINAL_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function filterObjectiveTrackerIssuesForAction(
  issues: LinearIssueSummary[],
  blockedIssueIds: Iterable<string> = []
): LinearIssueSummary[] {
  const blocked = new Set(
    Array.from(blockedIssueIds, (issueId) => issueId.trim()).filter(Boolean)
  );

  return issues.filter(
    (issue) => !isObjectiveTrackerTerminalStatus(issue.status) && !blocked.has(issue.id)
  );
}

export async function listObjectiveTrackerIssues(input: {
  projectId: string;
  objectiveKey: string;
  projectSlug?: string | null;
  refresh?: boolean;
  limit?: number;
}): Promise<{
  issues: LinearIssueSummary[];
  refreshedAt: string | null;
}> {
  const pullResult = await ensureLinearIssueCache({
    projectId: input.projectId,
    refresh: input.refresh,
    projectSlug: input.projectSlug,
  });
  const { issues } = await listLinearIssueSummaries({ limit: input.limit ?? 500 });

  return {
    issues: issues.filter((issue) =>
      (issue.labels ?? []).some((label) => matchesObjectiveLabel(label, input.objectiveKey))
    ),
    refreshedAt: pullResult?.pulledAt ?? null,
  };
}

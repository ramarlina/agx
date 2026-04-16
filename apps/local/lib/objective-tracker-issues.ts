// Tracker-agnostic objective issue helpers.
// Phase 1: Re-exports from the existing objective-linear-issues.ts with
// canonical tracker-agnostic names. Phase 2 will add tracker-specific
// dispatch based on trackerType.

export {
  matchesObjectiveLabel,
  isObjectiveLinearTerminalStatus as isObjectiveTrackerTerminalStatus,
  filterObjectiveLinearIssuesForAction as filterObjectiveTrackerIssuesForAction,
  listObjectiveLinearIssues as listObjectiveTrackerIssues,
} from "@/lib/objective-linear-issues";

export type { LinearIssueSummary as ObjectiveTrackerIssueSummary } from "@/lib/linear-issues";
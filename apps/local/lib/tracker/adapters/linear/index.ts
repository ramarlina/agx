// Linear adapter barrel export

export { LinearClient, getLinearClient, getProjectTicketToken, saveProjectTicketToken, deleteProjectTicketToken } from "./client";
export type { LinearToken, TicketProviderToken, LinearUser, LinearTeam, LinearCycle, LinearIssueLabel, CreateLinearIssueLabelInput, CreateLinearIssueInput, CreatedLinearIssue, LinearIssueNode } from "./client";
export { LinearAdapter } from "./adapter";

// Re-export the issue functions for backward compatibility during migration
export { pullLinearIssues, ensureLinearIssueCache, listLinearIssueSummaries, getLinearIssueContexts } from "./issues";
export type { LinearIssueSummary, LinearIssueContext, EnsureLinearIssueCacheInput, PullLinearIssuesResult } from "./issues";
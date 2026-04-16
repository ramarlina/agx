// Tracker-agnostic issue context for chat mentions.
// Phase 1: Re-exports from linear-issue-context.ts with canonical names.
// Phase 2: Will add tracker-specific mention node types and context builders.

export type {
  MentionedLinearIssueContext as MentionedTrackerIssueContext,
} from "@/lib/chat/linear-issue-context";

export {
  extractMentionedLinearIssueIds as extractMentionedTrackerIssueIds,
  buildLinearIssueContextPrefix as buildTrackerIssueContextPrefix,
} from "@/lib/chat/linear-issue-context";
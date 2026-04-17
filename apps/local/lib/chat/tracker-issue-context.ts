// Re-exports from tracker-item-context.ts for backward compatibility.
// TODO: migrate consumers to import from tracker-item-context directly, then delete this file.

export type {
  MentionedTrackerItemContext as MentionedTrackerIssueContext,
} from "@/lib/chat/tracker-item-context";

export {
  extractMentionedTrackerItemIds as extractMentionedTrackerIssueIds,
  buildTrackerItemContextPrefix as buildTrackerIssueContextPrefix,
} from "@/lib/chat/tracker-item-context";

// Tracker-agnostic execution prompt builder.
// Delegates to the existing linear-execution-prompt.ts since its language
// is already tracker-agnostic (references "issue tracker" instead of "Linear").
// This module provides canonical type names and re-exports for consumers
// that import from the tracker layer.

export type {
  LinearExecutionIssueContext as TrackerExecutionIssueContext,
  LinearExecutionProjectRepoContext as TrackerExecutionProjectRepoContext,
  LinearExecutionProjectContext as TrackerExecutionProjectContext,
  LinearExecutionRuntimeContext as TrackerExecutionRuntimeContext,
  LinearExecutionPromptInput as TrackerExecutionPromptInput,
  ResolvedLinearExecutionContext as ResolvedTrackerExecutionContext,
} from "@/lib/linear-execution-prompt";

export {
  buildLinearExecutionPrompt as buildTrackerExecutionPrompt,
  resolveLinearExecutionContext as resolveTrackerExecutionContext,
  renderLinearExecutionPromptTemplate as renderTrackerExecutionPromptTemplate,
} from "@/lib/linear-execution-prompt";
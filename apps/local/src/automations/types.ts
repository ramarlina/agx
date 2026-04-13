import type { GraphSchedule } from "@/src/graph/types";
import type {
  CatchUpPolicy,
  OverlapPolicy,
  PromptJob,
  PromptJobExecutionMode,
  RunStatus,
} from "@/src/prompt-scheduler/types";

export type AutomationState = "active" | "paused" | "stopped";
export type AutomationTriggerType = "scheduled" | "condition";
export type AutomationTargetType = "prompt_job" | "execution_graph";

export interface ScheduledAutomationTrigger {
  type: "scheduled";
  cadence?: string;
  cronExpr?: string;
  intervalMs?: number;
}

export interface ConditionAutomationTrigger {
  type: "condition";
  condition: string;
  checkEveryMs: number;
}

export type AutomationTrigger = ScheduledAutomationTrigger | ConditionAutomationTrigger;

export interface AutomationExecution {
  overlapPolicy?: OverlapPolicy;
  catchUpPolicy?: CatchUpPolicy;
  cancelCheckSec?: number;
  condition?: string;
  maxRuns?: number;
  maxConsecutiveFailures?: number;
  activeUntil?: string;
}

export interface PromptJobAutomationTarget {
  type: "prompt_job";
  agentId?: string;
  provider?: string;
  model?: string;
  cliArgs?: string;
  prompt?: string;
  objectiveId?: string;
  objectiveKey?: string;
  executionMode?: PromptJobExecutionMode;
}

export interface ExecutionGraphAutomationTarget {
  type: "execution_graph";
  graphId?: string;
  taskId?: string;
  resetNodeIds?: string[];
  rootMessageId?: string;
}

export type AutomationTarget = PromptJobAutomationTarget | ExecutionGraphAutomationTarget;

export interface AutomationDefinition {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  state: AutomationState;
  trigger: AutomationTrigger;
  execution?: AutomationExecution;
  target: AutomationTarget;
  createdAt?: string;
  body?: string;
}

export interface AutomationRuntimeState {
  scheduleHash: string;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastOutcome?: RunStatus | "skipped" | null;
  lastError?: string | null;
  updatedAt: string;
  runCount?: number;
  consecutiveFailures?: number;
  tickInProgress?: boolean;
  archivedAt?: string | null;
}

export interface AutomationRecord {
  definition: AutomationDefinition;
  runtimeState: AutomationRuntimeState;
  filePath: string;
  archived: boolean;
}

export interface AutomationListFilter {
  includeArchived?: boolean;
  state?: AutomationState;
  targetType?: AutomationTargetType;
  projectId?: string;
  ids?: string[];
  graphId?: string;
  taskId?: string;
  rootMessageId?: string;
}

export type AutomationUpdatePatch = Partial<
  Omit<AutomationDefinition, "trigger" | "execution" | "target">
> & {
  description?: string | null;
  projectId?: string | null;
  trigger?: Partial<ScheduledAutomationTrigger> | Partial<ConditionAutomationTrigger>;
  execution?: Partial<AutomationExecution> | null;
  target?: Partial<PromptJobAutomationTarget> | Partial<ExecutionGraphAutomationTarget>;
  body?: string;
};

export type AutomationStatePatch = Partial<
  Omit<AutomationRuntimeState, "scheduleHash" | "updatedAt">
> & {
  updatedAt?: string;
};

export const DEFAULT_OVERLAP_POLICY: OverlapPolicy = "skip";
export const DEFAULT_CATCH_UP_POLICY: CatchUpPolicy = "fire_once";
export const DEFAULT_CANCEL_CHECK_SEC = 5;
export const DEFAULT_CONDITION_CHECK_EVERY_MS = 300_000;
export const DEFAULT_GRAPH_INTERVAL_MS = 60_000;

export interface LegacyGraphAutomationRow {
  graphId: string;
  taskId: string;
  schedule: GraphSchedule;
  createdAt: string;
  updatedAt: string;
  executionState?: string;
}

export interface LegacyPromptJobLike extends PromptJob {
  updatedAt: string;
}

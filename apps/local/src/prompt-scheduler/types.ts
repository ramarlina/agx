export type PromptJobState = 'active' | 'paused' | 'stopped';
export type OverlapPolicy = 'skip' | 'queue' | 'allow';
export type CatchUpPolicy = 'fire_once' | 'replay_all' | 'skip';
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type TriggerType = 'scheduled' | 'condition';
export type PromptJobExecutionMode = 'prompt' | 'objective_worker' | 'linear_worker';

export type ObjectiveActionType = 'work_ticket' | 'run_prompt' | 'stop';

export type ObjectiveAction =
  | { action: 'work_ticket'; ticketId: string; reason: string }
  | { action: 'run_prompt'; prompt: string; reason: string }
  | { action: 'stop'; reason: string };

export interface ActionReceipt {
  action: string;
  jobName: string;
  reason: string;
  result: string;
  linearRunId?: string;
  chatRunId?: string;
  durationMs: number;
  status: 'success' | 'failed';
}

export const DEFAULT_PROMPT_JOB_EXECUTION_MODE: PromptJobExecutionMode = 'prompt';

export interface PromptJob {
  id: string;
  name: string;
  prompt: string;
  agentId: string;
  projectId: string;
  objectiveId?: string | null;
  objectiveKey?: string | null;
  provider: string;
  model: string;
  cliArgs: string;
  cronExpr: string;
  cadence: string;
  state: PromptJobState;
  overlapPolicy: OverlapPolicy;
  catchUpPolicy: CatchUpPolicy;
  cancelCheckSec: number;
  executionMode: PromptJobExecutionMode;
  /** For linear_worker: the prompt injected into the agent chat session when working a ticket. */
  scriptPrompt: string;
  /** For linear_worker: the team whose agents participate in the linear chat session. */
  teamId: string;
  /** True for system-managed jobs that cannot be deleted by users */
  builtIn?: boolean;
  condition: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  /** Computed: previous cron occurrence (not persisted) */
  prevScheduledAt?: number | null;
  lastOutcome: RunStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptRun {
  id: string;
  jobId: string;
  status: RunStatus;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  hostPid: number | null;
  hostCommand: string | null;
  createdAt: string;
}

export interface CreatePromptJobInput {
  name: string;
  prompt: string;
  agentId?: string;
  projectId?: string;
  objectiveId?: string | null;
  objectiveKey?: string | null;
  provider: string;
  model?: string;
  cliArgs?: string;
  cronExpr?: string;
  cadence: string;
  overlapPolicy?: OverlapPolicy;
  catchUpPolicy?: CatchUpPolicy;
  cancelCheckSec?: number;
  executionMode?: PromptJobExecutionMode;
  scriptPrompt?: string;
  teamId?: string;
  builtIn?: boolean;
  // Legacy compatibility only. New callers should always send cadence.
  triggerType?: TriggerType;
  condition?: string;
  checkEveryMs?: number;
}

export interface UpdatePromptJobInput {
  name?: string;
  prompt?: string;
  scriptPrompt?: string;
  teamId?: string;
  agentId?: string;
  projectId?: string;
  objectiveId?: string | null;
  objectiveKey?: string | null;
  provider?: string;
  model?: string;
  cliArgs?: string;
  cadence?: string;
  cronExpr?: string;
  state?: PromptJobState;
  overlapPolicy?: OverlapPolicy;
  catchUpPolicy?: CatchUpPolicy;
  cancelCheckSec?: number;
  executionMode?: PromptJobExecutionMode;
  // Legacy compatibility only. New callers should always send cadence.
  triggerType?: TriggerType;
  condition?: string;
  checkEveryMs?: number;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastOutcome?: RunStatus | null;
}

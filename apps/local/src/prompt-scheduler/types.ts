export type PromptJobState = 'active' | 'paused' | 'stopped';
export type OverlapPolicy = 'skip' | 'queue' | 'allow';
export type CatchUpPolicy = 'fire_once' | 'replay_all' | 'skip';
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type TriggerType = 'scheduled' | 'condition';

export interface PromptJob {
  id: string;
  name: string;
  prompt: string;
  agentId: string;
  projectId: string;
  provider: string;
  model: string;
  cliArgs: string;
  cronExpr: string;
  cadence: string;
  state: PromptJobState;
  overlapPolicy: OverlapPolicy;
  catchUpPolicy: CatchUpPolicy;
  cancelCheckSec: number;
  triggerType: TriggerType;
  condition: string;
  checkEveryMs: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
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
  provider: string;
  model?: string;
  cliArgs?: string;
  cronExpr?: string;
  cadence: string;
  overlapPolicy?: OverlapPolicy;
  catchUpPolicy?: CatchUpPolicy;
  cancelCheckSec?: number;
  triggerType?: TriggerType;
  condition?: string;
  checkEveryMs?: number;
}

export interface UpdatePromptJobInput {
  name?: string;
  prompt?: string;
  agentId?: string;
  projectId?: string;
  provider?: string;
  model?: string;
  cliArgs?: string;
  cadence?: string;
  cronExpr?: string;
  state?: PromptJobState;
  overlapPolicy?: OverlapPolicy;
  catchUpPolicy?: CatchUpPolicy;
  cancelCheckSec?: number;
  triggerType?: TriggerType;
  condition?: string;
  checkEveryMs?: number;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastOutcome?: RunStatus | null;
}

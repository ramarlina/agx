import { getPromptJobStore } from './get-store';
import type { PromptJob } from './types';

export const LINEAR_WORKER_JOB_NAME = 'Linear worker';
export const LINEAR_WORKER_DEFAULT_CADENCE = 'every 30 minutes';
export const LINEAR_WORKER_DEFAULT_PROMPT = [
  'Observe the full state of the Linear workspace — all teams, all issues, active sessions.',
  'Decide what single action most advances the workspace right now.',
  'If a specific ticket should be worked, choose work_ticket.',
  'If the workspace needs work not captured by an existing ticket, choose run_prompt with detailed instructions.',
  'If no action should be taken right now, choose stop.',
].join('\n');

export function findLinearWorkerJob(
  projectId?: string,
): PromptJob | null {
  const store = getPromptJobStore();
  const jobs = store.listJobs(projectId ? { projectId } : undefined);
  return jobs.find((job) => job.executionMode === 'linear_worker') ?? null;
}

export function ensureLinearWorkerJob(input: {
  projectId?: string;
  prompt?: string;
  cadence?: string;
  agentId?: string;
  provider?: string;
  model?: string;
}): PromptJob {
  const existing = findLinearWorkerJob(input.projectId);
  if (existing) {
    return existing;
  }

  const store = getPromptJobStore();
  return store.createJob({
    name: LINEAR_WORKER_JOB_NAME,
    prompt: input.prompt || LINEAR_WORKER_DEFAULT_PROMPT,
    executionMode: 'linear_worker',
    projectId: input.projectId,
    builtIn: true,
    cadence: input.cadence || LINEAR_WORKER_DEFAULT_CADENCE,
    provider: input.provider ?? 'claude',
    model: input.model,
    agentId: input.agentId,
  });
}

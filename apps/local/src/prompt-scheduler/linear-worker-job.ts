import { getPromptJobStore } from './get-store';
import type { PromptJob } from './types';
export {
  LINEAR_WORKER_JOB_NAME,
  LINEAR_WORKER_DEFAULT_CADENCE,
  LINEAR_WORKER_DEFAULT_PROMPT,
} from './linear-worker-constants';
import {
  LINEAR_WORKER_JOB_NAME,
  LINEAR_WORKER_DEFAULT_CADENCE,
  LINEAR_WORKER_DEFAULT_PROMPT,
} from './linear-worker-constants';

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

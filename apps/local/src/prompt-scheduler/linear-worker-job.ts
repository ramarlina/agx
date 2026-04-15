// TODO(multi-tracker): `executionMode: 'linear_worker'` is Linear-specific.
// When adding Jira or other trackers, either:
//   (a) Add new modes ('jira_worker', 'github_issues_worker') and parallel job helpers, or
//   (b) Introduce a single 'ticket_worker' mode with a `trackerType` field on the PromptJob.
// Option (b) requires a DB migration to add `tracker_type` to the prompt_jobs table.
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

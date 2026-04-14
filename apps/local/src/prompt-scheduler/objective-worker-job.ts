import { getPromptJobStore } from './get-store';
import type { PromptJob } from './types';

export const OBJECTIVE_WORKER_JOB_NAME = 'Objective worker';
export const OBJECTIVE_WORKER_DEFAULT_CADENCE = 'every 2 hours';
export const OBJECTIVE_WORKER_DEFAULT_PROMPT = [
  'Observe the full state of this objective — goal, notes, activity timeline, Linear tickets, active sessions, other scheduled tasks, and project context.',
  'Decide what single action most advances this objective right now.',
  'If a specific ticket should be worked, choose work_ticket.',
  'If the objective needs work not captured by an existing ticket, choose run_prompt with detailed instructions.',
  'If no tickets are actionable but the objective is not done, choose run_prompt to plan — review existing notes, refine the latest plan, or draft next steps. Prefer appending to an existing note over creating a new one.',
  'If the objective is done or no action (including planning) is useful right now, choose stop.',
].join('\n');

export function findObjectiveWorkerJob(
  projectId: string,
  objectiveId: string,
): PromptJob | null {
  const store = getPromptJobStore();
  const jobs = store.listJobs({ projectId, objectiveId });
  return jobs.find((job) => job.executionMode === 'objective_worker') ?? null;
}

export function ensureObjectiveWorkerJob(input: {
  projectId: string;
  objectiveId: string;
  objectiveKey: string;
  cadence?: string;
}): PromptJob {
  const existing = findObjectiveWorkerJob(input.projectId, input.objectiveId);
  if (existing) {
    return existing;
  }

  const store = getPromptJobStore();
  return store.createJob({
    name: OBJECTIVE_WORKER_JOB_NAME,
    prompt: OBJECTIVE_WORKER_DEFAULT_PROMPT,
    executionMode: 'objective_worker',
    projectId: input.projectId,
    objectiveId: input.objectiveId,
    objectiveKey: input.objectiveKey,
    builtIn: true,
    cadence: input.cadence || OBJECTIVE_WORKER_DEFAULT_CADENCE,
    provider: 'claude',
  });
}

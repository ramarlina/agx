// Task worker job helpers — tracker-agnostic replacement for linear-worker-job.
// Uses executionMode: 'task_worker' instead of 'linear_worker'.
import { getPromptJobStore } from "./get-store";
import type { PromptJob } from "./types";
export {
  TASK_WORKER_JOB_NAME,
  TASK_WORKER_DEFAULT_CADENCE,
  TASK_WORKER_DEFAULT_PROMPT,
} from "./task-worker-constants";
import {
  TASK_WORKER_JOB_NAME,
  TASK_WORKER_DEFAULT_CADENCE,
  TASK_WORKER_DEFAULT_PROMPT,
} from "./task-worker-constants";

export function findTaskWorkerJob(
  projectId?: string
): PromptJob | null {
  const store = getPromptJobStore();
  const jobs = store.listJobs(projectId ? { projectId } : undefined);
  return jobs.find((job) => job.executionMode === "task_worker") ?? null;
}

export function ensureTaskWorkerJob(input: {
  projectId?: string;
  prompt?: string;
  cadence?: string;
  agentId?: string;
  provider?: string;
  model?: string;
}): PromptJob {
  const existing = findTaskWorkerJob(input.projectId);
  if (existing) {
    return existing;
  }

  const store = getPromptJobStore();
  return store.createJob({
    name: TASK_WORKER_JOB_NAME,
    prompt: input.prompt || TASK_WORKER_DEFAULT_PROMPT,
    executionMode: "task_worker",
    projectId: input.projectId,
    builtIn: true,
    cadence: input.cadence || TASK_WORKER_DEFAULT_CADENCE,
    provider: input.provider ?? "claude",
    model: input.model,
    agentId: input.agentId,
  });
}
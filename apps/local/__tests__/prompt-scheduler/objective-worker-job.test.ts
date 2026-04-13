/**
 * @jest-environment node
 */

const mockGetPromptJobStore = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

import {
  OBJECTIVE_WORKER_JOB_NAME,
  OBJECTIVE_WORKER_DEFAULT_CADENCE,
  OBJECTIVE_WORKER_DEFAULT_PROMPT,
  findObjectiveWorkerJob,
  ensureObjectiveWorkerJob,
} from '@/src/prompt-scheduler/objective-worker-job';

describe('objective-worker-job', () => {
  const mockStore = {
    listJobs: jest.fn(),
    createJob: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPromptJobStore.mockReturnValue(mockStore);
  });

  describe('findObjectiveWorkerJob', () => {
    it('returns the first objective_worker job for the objective', () => {
      const workerJob = {
        id: 'job-1',
        executionMode: 'objective_worker',
        objectiveId: 'obj-1',
        builtIn: true,
      };
      mockStore.listJobs.mockReturnValue([workerJob]);

      const result = findObjectiveWorkerJob('proj-1', 'obj-1');

      expect(result).toEqual(workerJob);
      expect(mockStore.listJobs).toHaveBeenCalledWith({
        projectId: 'proj-1',
        objectiveId: 'obj-1',
      });
    });

    it('returns null when no objective_worker job exists', () => {
      mockStore.listJobs.mockReturnValue([
        { id: 'job-2', executionMode: 'prompt', objectiveId: 'obj-1' },
      ]);

      const result = findObjectiveWorkerJob('proj-1', 'obj-1');
      expect(result).toBeNull();
    });
  });

  describe('ensureObjectiveWorkerJob', () => {
    it('returns existing job if one already exists', () => {
      const existingJob = {
        id: 'job-1',
        executionMode: 'objective_worker',
        objectiveId: 'obj-1',
        builtIn: true,
      };
      mockStore.listJobs.mockReturnValue([existingJob]);

      const result = ensureObjectiveWorkerJob({
        projectId: 'proj-1',
        objectiveId: 'obj-1',
        objectiveKey: 'my-objective',
      });

      expect(result).toEqual(existingJob);
      expect(mockStore.createJob).not.toHaveBeenCalled();
    });

    it('creates a new built-in job when none exists', () => {
      mockStore.listJobs.mockReturnValue([]);
      const createdJob = {
        id: 'job-new',
        executionMode: 'objective_worker',
        objectiveId: 'obj-1',
        builtIn: true,
        name: OBJECTIVE_WORKER_JOB_NAME,
      };
      mockStore.createJob.mockReturnValue(createdJob);

      const result = ensureObjectiveWorkerJob({
        projectId: 'proj-1',
        objectiveId: 'obj-1',
        objectiveKey: 'my-objective',
      });

      expect(result).toEqual(createdJob);
      expect(mockStore.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          name: OBJECTIVE_WORKER_JOB_NAME,
          executionMode: 'objective_worker',
          projectId: 'proj-1',
          objectiveId: 'obj-1',
          objectiveKey: 'my-objective',
          builtIn: true,
          cadence: OBJECTIVE_WORKER_DEFAULT_CADENCE,
          prompt: OBJECTIVE_WORKER_DEFAULT_PROMPT,
          provider: 'claude',
        }),
      );
    });

    it('accepts optional cadence override', () => {
      mockStore.listJobs.mockReturnValue([]);
      mockStore.createJob.mockReturnValue({ id: 'job-new' });

      ensureObjectiveWorkerJob({
        projectId: 'proj-1',
        objectiveId: 'obj-1',
        objectiveKey: 'my-objective',
        cadence: 'every 30 minutes',
      });

      expect(mockStore.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          cadence: 'every 30 minutes',
        }),
      );
    });
  });
});

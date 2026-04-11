/**
 * @jest-environment node
 */

const mockGetPromptJobStore = jest.fn();
const mockPollDueJobs = jest.fn();
const mockGetAgent = jest.fn();
const mockGetAgentSkills = jest.fn();
const mockBuildCliAttempts = jest.fn();
const mockRunCliResponse = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

jest.mock('@/src/prompt-scheduler/engine', () => ({
  pollDueJobs: (...args: unknown[]) => mockPollDueJobs(...args),
}));

jest.mock('@/lib/db', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  getAgentSkills: (...args: unknown[]) => mockGetAgentSkills(...args),
}));

jest.mock('@/lib/auth-mode', () => ({
  LOCAL_USER: { id: 'local-user-id' },
}));

jest.mock('@/lib/cli-runner', () => ({
  buildCliAttempts: (...args: unknown[]) => mockBuildCliAttempts(...args),
  runCliResponse: (...args: unknown[]) => mockRunCliResponse(...args),
}));

describe('prompt scheduler processor', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([]),
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockPollDueJobs.mockResolvedValue({ queued: [], skipped: [] });
    mockGetAgent.mockResolvedValue(null);
    mockGetAgentSkills.mockResolvedValue([]);
    mockBuildCliAttempts.mockReturnValue([]);
    mockRunCliResponse.mockResolvedValue(undefined);
  });

  test('processPromptJobs redrives existing queued runs', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      id: 'job-queued',
      name: 'Inbox watcher',
      prompt: 'Summarize my unread emails',
      agentId: '',
      projectId: '',
      provider: 'claude',
      model: '',
      cliArgs: '',
      cronExpr: '*/5 * * * *',
      cadence: 'Every 5 minutes',
      state: 'active',
      overlapPolicy: 'skip',
      catchUpPolicy: 'fire_once',
      cancelCheckSec: 5,
      condition: '',
      nextRunAt: Date.now() + 300000,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const orphanedRun = { id: 'run-queued', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([orphanedRun]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('Recovered run');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    const result = await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.dispatched).toBe(1);
    expect(mockRunCliResponse).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(
      orphanedRun.id,
      expect.objectContaining({ status: 'running' }),
    );
    expect(updateJob).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ lastOutcome: 'success' }),
    );
  });

  test('condition-gated runs skip the action when the gate fails', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      id: 'job-gated',
      name: 'Inbox watcher',
      prompt: 'Summarize my unread emails',
      agentId: '',
      projectId: '',
      provider: 'claude',
      model: '',
      cliArgs: '',
      cronExpr: '*/5 * * * *',
      cadence: 'Every 5 minutes',
      state: 'active',
      overlapPolicy: 'skip',
      catchUpPolicy: 'fire_once',
      cancelCheckSec: 5,
      condition: 'there are unread emails',
      nextRunAt: Date.now() + 300000,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const run = { id: 'run-gated', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([run]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('no');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRunCliResponse).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        status: 'success',
        output: expect.stringContaining('condition not met'),
      }),
    );
  });

  test('requestPromptJobPump schedules pending work once a pump registers', async () => {
    jest.useFakeTimers();

    const { registerPromptJobPump, requestPromptJobPump } = await import('@/src/prompt-scheduler/processor');
    const pump = jest.fn().mockResolvedValue(undefined);

    expect(requestPromptJobPump()).toBe(false);
    registerPromptJobPump(pump);

    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(pump).toHaveBeenCalledTimes(1);
  });
});

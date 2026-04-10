/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

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

describe('/api/prompt-jobs/poll', () => {
  let store: Record<string, unknown>;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    store = {};
    mockGetPromptJobStore.mockReturnValue(store);
    mockPollDueJobs.mockResolvedValue({ queued: [], skipped: [] });
    mockGetAgent.mockResolvedValue(null);
    mockGetAgentSkills.mockResolvedValue([]);
    mockBuildCliAttempts.mockReturnValue([]);
    mockRunCliResponse.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('treats an empty request body as a silent scheduler poll', async () => {
    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ queued: [], skipped: [] });
    expect(mockPollDueJobs).toHaveBeenCalledWith(store);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('logs malformed JSON bodies and falls back to the default poll path', async () => {
    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ queued: [], skipped: [] });
    expect(mockPollDueJobs).toHaveBeenCalledWith(store);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[prompt-jobs/poll] failed to parse request body:',
      expect.any(SyntaxError),
    );
  });

  test('logs structurally unexpected bodies instead of dispatching a bad job id', async () => {
    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: JSON.stringify({ jobId: 123 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ queued: [], skipped: [] });
    expect(mockPollDueJobs).toHaveBeenCalledWith(store);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[prompt-jobs/poll] unexpected request body:',
      { jobId: 123 },
    );
  });

  test('manual Run now evaluates the condition gate before running the prompt', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      id: 'job-1',
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
    const run = { id: 'run-1', jobId: job.id, status: 'queued' };
    store = {
      getJob: jest.fn().mockReturnValue(job),
      createRun: jest.fn().mockReturnValue(run),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse
      .mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
        onDelta?.('yes');
      })
      .mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
        onDelta?.('Action complete');
      });

    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: JSON.stringify({ jobId: job.id }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    expect(mockRunCliResponse).toHaveBeenCalledTimes(2);
    expect(mockRunCliResponse.mock.calls[0][0].prompt).toContain('Condition: there are unread emails');
    expect(mockRunCliResponse.mock.calls[1][0].prompt).toBe('Summarize my unread emails');
    expect(updateJob).toHaveBeenCalledWith(job.id, expect.objectContaining({ lastOutcome: 'success' }));
  });

  test('manual Run now skips the action when the condition gate fails', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      id: 'job-2',
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
    const run = { id: 'run-2', jobId: job.id, status: 'queued' };
    store = {
      getJob: jest.fn().mockReturnValue(job),
      createRun: jest.fn().mockReturnValue(run),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('no');
    });

    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: JSON.stringify({ jobId: job.id }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    expect(mockRunCliResponse).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        status: 'success',
        output: expect.stringContaining('condition not met'),
      }),
    );
  });
});

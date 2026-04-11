/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const mockGetPromptJobStore = jest.fn();
const mockPollDueJobs = jest.fn();
const mockRequestPromptJobPump = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

jest.mock('@/src/prompt-scheduler/engine', () => ({
  pollDueJobs: (...args: unknown[]) => mockPollDueJobs(...args),
}));

jest.mock('@/src/prompt-scheduler/processor', () => ({
  requestPromptJobPump: (...args: unknown[]) => mockRequestPromptJobPump(...args),
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
    mockRequestPromptJobPump.mockReturnValue(true);
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
    expect(mockRequestPromptJobPump).toHaveBeenCalled();
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

  test('manual Run now queues the job and nudges the shared pump', async () => {
    const job = { id: 'job-1' };
    const run = { id: 'run-1', jobId: job.id, status: 'queued' };
    store = {
      getJob: jest.fn().mockReturnValue(job),
      createRun: jest.fn().mockReturnValue(run),
    };
    mockGetPromptJobStore.mockReturnValue(store);

    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: JSON.stringify({ jobId: job.id }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ queued: [run], skipped: [] });
    expect((store.createRun as jest.Mock)).toHaveBeenCalledWith(job.id);
    expect(mockRequestPromptJobPump).toHaveBeenCalled();
    expect(mockPollDueJobs).not.toHaveBeenCalled();
  });

  test('manual Run now returns 404 when the job does not exist', async () => {
    store = {
      getJob: jest.fn().mockReturnValue(null),
    };
    mockGetPromptJobStore.mockReturnValue(store);

    const { POST } = await import('@/app/api/prompt-jobs/poll/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/poll', {
      method: 'POST',
      body: JSON.stringify({ jobId: 'missing-job' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Job not found' });
    expect(mockRequestPromptJobPump).not.toHaveBeenCalled();
  });
});

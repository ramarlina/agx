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
  const store = {};
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
});

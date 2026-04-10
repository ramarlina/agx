/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const mockGetPromptJobStore = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

describe('/api/prompt-jobs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST normalizes a raw cron cadence into schedule-first job input', async () => {
    const createJob = jest.fn().mockImplementation((input) => ({ id: 'job-1', ...input }));
    mockGetPromptJobStore.mockReturnValue({ createJob });

    const { POST } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Inbox watcher',
        prompt: 'Check my inbox',
        cadence: '0 */4 * * *',
        condition: 'there are unread emails',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Inbox watcher',
      prompt: 'Check my inbox',
      cadence: 'Every 4 hours',
      cronExpr: '0 */4 * * *',
      condition: 'there are unread emails',
    }));
    expect(payload.job).toEqual(expect.objectContaining({
      id: 'job-1',
      cadence: 'Every 4 hours',
      cronExpr: '0 */4 * * *',
    }));
  });

  test('POST accepts legacy condition-trigger input by converting it to a schedule', async () => {
    const createJob = jest.fn().mockImplementation((input) => ({ id: 'job-2', ...input }));
    mockGetPromptJobStore.mockReturnValue({ createJob });

    const { POST } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Legacy inbox watcher',
        prompt: 'Check my inbox',
        triggerType: 'condition',
        checkEveryMs: 300000,
        condition: 'there are unread emails',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      cadence: 'Every 5 minutes',
      cronExpr: '*/5 * * * *',
      condition: 'there are unread emails',
    }));
  });

  test('PATCH rejects clearing cadence because prompt jobs always require a schedule', async () => {
    mockGetPromptJobStore.mockReturnValue({
      getJob: jest.fn().mockReturnValue({ id: 'job-1' }),
      updateJob: jest.fn(),
    });

    const { PATCH } = await import('@/app/api/prompt-jobs/[id]/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/job-1', {
      method: 'PATCH',
      body: JSON.stringify({ cadence: '' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'job-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Cadence cannot be cleared');
  });

  test('PATCH converts legacy condition-trigger updates into scheduled cadence updates', async () => {
    const updateJob = jest.fn().mockImplementation((_id, input) => ({ id: 'job-1', ...input }));
    mockGetPromptJobStore.mockReturnValue({
      getJob: jest.fn().mockReturnValue({ id: 'job-1', cadence: 'Every hour', cronExpr: '0 * * * *' }),
      updateJob,
    });

    const { PATCH } = await import('@/app/api/prompt-jobs/[id]/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs/job-1', {
      method: 'PATCH',
      body: JSON.stringify({
        triggerType: 'condition',
        checkEveryMs: 300000,
        condition: 'there are unread emails',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'job-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      cadence: 'Every 5 minutes',
      cronExpr: '*/5 * * * *',
      condition: 'there are unread emails',
    }));
    expect(payload.job).toEqual(expect.objectContaining({
      id: 'job-1',
      cadence: 'Every 5 minutes',
      cronExpr: '*/5 * * * *',
      condition: 'there are unread emails',
    }));
  });
});

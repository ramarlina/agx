/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { PromptJobDeleteError } from '@/src/prompt-scheduler/store';

const mockGetPromptJobStore = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

describe('/api/prompt-jobs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET excludes objective-owned jobs by default', async () => {
    const listJobs = jest.fn().mockReturnValue([]);
    mockGetPromptJobStore.mockReturnValue({ listJobs });

    const { GET } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs?projectId=project-1');

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith({
      projectId: 'project-1',
      includeObjectiveJobs: false,
    });
  });

  test('GET can include objective-owned jobs when requested', async () => {
    const listJobs = jest.fn().mockReturnValue([]);
    mockGetPromptJobStore.mockReturnValue({ listJobs });

    const { GET } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest(
      'http://localhost/api/prompt-jobs?projectId=project-1&includeObjectiveJobs=true'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith({
      projectId: 'project-1',
      includeObjectiveJobs: true,
    });
  });

  test('GET can scope the shared list to a specific objective', async () => {
    const listJobs = jest.fn().mockReturnValue([]);
    mockGetPromptJobStore.mockReturnValue({ listJobs });

    const { GET } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest(
      'http://localhost/api/prompt-jobs?projectId=project-1&objectiveId=objective-7'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith({
      projectId: 'project-1',
      objectiveId: 'objective-7',
      includeObjectiveJobs: false,
    });
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

  test('POST supports objective Linear worker jobs and fills the default prompt when omitted', async () => {
    const createJob = jest.fn().mockImplementation((input) => ({ id: 'job-3', ...input }));
    mockGetPromptJobStore.mockReturnValue({ createJob });

    const { POST } = await import('@/app/api/prompt-jobs/route');
    const request = new NextRequest('http://localhost/api/prompt-jobs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Work objective Linear tickets',
        projectId: 'project-1',
        objectiveId: 'objective-1',
        objectiveKey: 'growth-daily-visitors',
        executionMode: 'objective_worker',
        cadence: '0 9 * * *',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      objectiveId: 'objective-1',
      objectiveKey: 'growth-daily-visitors',
      executionMode: 'objective_worker',
      prompt: expect.stringContaining('Observe the full state of this objective'),
      cadence: 'Daily at 9 AM',
    }));
    expect(payload.job).toEqual(expect.objectContaining({
      id: 'job-3',
      cadence: 'Daily at 9 AM',
      cronExpr: '0 9 * * *',
      executionMode: 'objective_worker',
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

  test('DELETE returns 409 when a queued or running run still exists', async () => {
    const deleteJob = jest
      .fn()
      .mockImplementation(() => {
        throw new PromptJobDeleteError(
          'Cannot delete a scheduled task while a run is queued or running. Cancel the active run first.',
          409,
        );
      });
    mockGetPromptJobStore.mockReturnValue({
      getJob: jest.fn().mockReturnValue({ id: 'job-1', name: 'Daily review' }),
      deleteJob,
    });

    const { DELETE } = await import('@/app/api/prompt-jobs/[id]/route');

    const response = await DELETE(
      new NextRequest('http://localhost/api/prompt-jobs/job-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'job-1' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('Cancel the active run first');
    expect(deleteJob).toHaveBeenCalledWith('job-1');
  });

  test('DELETE returns 400 for built-in jobs that cannot be removed', async () => {
    const deleteJob = jest
      .fn()
      .mockImplementation(() => {
        throw new PromptJobDeleteError('Cannot delete built-in job. Use pause instead.', 400);
      });
    mockGetPromptJobStore.mockReturnValue({
      getJob: jest.fn().mockReturnValue({ id: 'job-1', builtIn: true }),
      deleteJob,
    });

    const { DELETE } = await import('@/app/api/prompt-jobs/[id]/route');

    const response = await DELETE(
      new NextRequest('http://localhost/api/prompt-jobs/job-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'job-1' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Use pause instead');
  });
});

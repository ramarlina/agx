/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db-instance';
import { createDbServerClientWithRequest } from '@/lib/db-server';

jest.mock('@/lib/db-instance', () => ({
  db: {
    getTaskLogs: jest.fn(),
    addTaskLog: jest.fn(),
    getTask: jest.fn(),
  },
}));

jest.mock('@/lib/db-server', () => ({
  createDbServerClientWithRequest: jest.fn(),
}));

jest.mock('@/src/graph/store', () => ({
  getGraph: jest.fn().mockResolvedValue(null),
}));

const mockGetTaskLogs = db.getTaskLogs as jest.Mock;
const mockAddTaskLog = db.addTaskLog as jest.Mock;
const mockGetTask = db.getTask as jest.Mock;
const mockCreateServerDbWithRequest = createDbServerClientWithRequest as jest.Mock;
const mockGetUser = jest.fn();

describe('/api/tasks/[id]/logs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
      },
    });
    mockGetTask.mockResolvedValue({ id: 'task-1', user_id: 'user-123' });
  });

  describe('GET', () => {
    test('returns logs for a task', async () => {
      const mockLogs = [
        { id: 'log-1', task_id: 'task-1', content: 'Started coding', created_at: '2024-01-01' },
        { id: 'log-2', task_id: 'task-1', content: 'Tests passing', created_at: '2024-01-02' },
      ];
      mockGetTaskLogs.mockResolvedValue(mockLogs);

      const { GET } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs');
      const response = await GET(request, { params: Promise.resolve({ id: 'task-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.logs).toEqual(mockLogs);
      expect(mockGetTaskLogs).toHaveBeenCalledWith('task-1', expect.any(Object));
    });

    test('returns empty array for task with no logs', async () => {
      mockGetTaskLogs.mockResolvedValue([]);

      const { GET } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs');
      const response = await GET(request, { params: Promise.resolve({ id: 'task-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.logs).toEqual([]);
    });

    test('handles errors gracefully', async () => {
      mockGetTaskLogs.mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs');
      const response = await GET(request, { params: Promise.resolve({ id: 'task-1' }) });

      expect(response.status).toBe(500);
    });
  });

  describe('POST', () => {
    test('adds a log entry', async () => {
      const mockLog = { id: 'log-new', task_id: 'task-1', content: 'New log entry', created_at: '2024-01-03' };
      mockAddTaskLog.mockResolvedValue(mockLog);

      const { POST } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs', {
        method: 'POST',
        body: JSON.stringify({ content: 'New log entry' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'task-1' }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.log).toEqual(mockLog);
      expect(mockAddTaskLog).toHaveBeenCalledWith('task-1', 'New log entry', 'output', undefined);
    });

    test('returns 400 when content is missing', async () => {
      const { POST } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'task-1' }) });

      expect(response.status).toBe(400);
    });

    test('handles errors gracefully', async () => {
      mockAddTaskLog.mockRejectedValue(new Error('Database error'));

      const { POST } = await import('@/app/api/tasks/[id]/logs/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/logs', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'task-1' }) });

      expect(response.status).toBe(500);
    });
  });
});

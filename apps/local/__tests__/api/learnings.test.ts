/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const mockGetLearnings = jest.fn();
const mockAddLearning = jest.fn();
const mockDeleteLearning = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@/lib/db-instance', () => ({
  db: {
    getLearnings: mockGetLearnings,
    addLearning: mockAddLearning,
    deleteLearning: mockDeleteLearning,
  },
}));

jest.mock('@/lib/db-server', () => ({
  createDbServerClientWithRequest: jest.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

describe('/api/learnings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: '2c3cc1ca-956d-4b62-b295-4d2d3374103f' } },
      error: null,
    });
  });

  describe('GET', () => {
    test('returns learnings for default scope (global)', async () => {
      const mockLearnings = [
        { id: 'learn-1', scope: 'global', content: 'Learning 1' },
        { id: 'learn-2', scope: 'global', content: 'Learning 2' },
      ];
      mockGetLearnings.mockResolvedValue(mockLearnings);

      const { GET } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.learnings).toEqual(mockLearnings);
      expect(mockGetLearnings).toHaveBeenCalledWith('global', undefined, '2c3cc1ca-956d-4b62-b295-4d2d3374103f');
    });

    test('returns learnings for specific scope', async () => {
      const mockLearnings = [{ id: 'learn-1', scope: 'project', content: 'Project learning' }];
      mockGetLearnings.mockResolvedValue(mockLearnings);

      const { GET } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings?scope=project&scopeId=my-project');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetLearnings).toHaveBeenCalledWith('project', 'my-project', '2c3cc1ca-956d-4b62-b295-4d2d3374103f');
    });

    test('returns learnings for authenticated user', async () => {
      const mockLearnings = [{ id: 'learn-1', scope: 'global', content: 'User learning' }];
      mockGetLearnings.mockResolvedValue(mockLearnings);

      const { GET } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockGetLearnings).toHaveBeenCalledWith('global', undefined, '2c3cc1ca-956d-4b62-b295-4d2d3374103f');
    });

    test('handles errors gracefully', async () => {
      mockGetLearnings.mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings');
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Failed to fetch learnings');
    });
  });

  describe('POST', () => {
    test('creates a new learning', async () => {
      const mockLearning = { id: 'learn-new', scope: 'global', content: 'New learning' };
      mockAddLearning.mockResolvedValue(mockLearning);

      const { POST } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings', {
        method: 'POST',
        body: JSON.stringify({ scope: 'global', content: 'New learning' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.learning).toEqual(mockLearning);
    });

    test('creates learning with scopeId', async () => {
      const mockLearning = { id: 'learn-new', scope: 'task', scopeId: 'task-1', content: 'Task learning' };
      mockAddLearning.mockResolvedValue(mockLearning);

      const { POST } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings', {
        method: 'POST',
        body: JSON.stringify({ scope: 'task', scopeId: 'task-1', content: 'Task learning' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockAddLearning).toHaveBeenCalledWith('task', 'Task learning', 'task-1', '2c3cc1ca-956d-4b62-b295-4d2d3374103f');
    });

    test('returns 400 when scope is missing', async () => {
      const { POST } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings', {
        method: 'POST',
        body: JSON.stringify({ content: 'Learning without scope' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    test('returns 400 when content is missing', async () => {
      const { POST } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings', {
        method: 'POST',
        body: JSON.stringify({ scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    test('handles errors gracefully', async () => {
      mockAddLearning.mockRejectedValue(new Error('Database error'));

      const { POST } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings', {
        method: 'POST',
        body: JSON.stringify({ scope: 'global', content: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    test('deletes a learning', async () => {
      mockDeleteLearning.mockResolvedValue(undefined);

      const { DELETE } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings?id=learn-1');
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDeleteLearning).toHaveBeenCalledWith('learn-1', '2c3cc1ca-956d-4b62-b295-4d2d3374103f');
    });

    test('returns 400 when id is missing', async () => {
      const { DELETE } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings');
      const response = await DELETE(request);

      expect(response.status).toBe(400);
    });

    test('handles errors gracefully', async () => {
      mockDeleteLearning.mockRejectedValue(new Error('Database error'));

      const { DELETE } = await import('@/app/api/learnings/route');
      const request = new NextRequest('http://localhost/api/learnings?id=learn-1');
      const response = await DELETE(request);

      expect(response.status).toBe(500);
    });
  });
});

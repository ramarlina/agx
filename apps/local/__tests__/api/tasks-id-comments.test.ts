/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const LOCAL_USER_ID = '2c3cc1ca-956d-4b62-b295-4d2d3374103f';

const mockGetTask = jest.fn();
const mockGetTaskComments = jest.fn();
const mockAddTaskComment = jest.fn();
const mockBuildTaskContext = jest.fn();
const mockSignTask = jest.fn();
const mockCreateAdminDb = jest.fn();

jest.mock('@/lib/db-instance', () => ({
  db: {
    getTask: mockGetTask,
    getTaskComments: mockGetTaskComments,
    addTaskComment: mockAddTaskComment,
  },
}));

jest.mock('@/lib/db', () => ({
  resolveTaskConfig: jest.fn((task, config) => ({
    provider: task.provider || config?.provider || 'gemini',
    model: task.model || config?.model || '',
    swarm: task.swarm ?? config?.swarm ?? false,
    swarm_models: task.swarm_models || config?.swarm_models || [],
  })),
}));

jest.mock('@/lib/db-adapter', () => ({
  createAdminDbClient: mockCreateAdminDb,
}));

jest.mock('@/lib/task-context', () => ({
  buildTaskContext: mockBuildTaskContext,
}));

jest.mock('@/lib/security', () => ({
  signTask: mockSignTask,
}));

describe('/api/tasks/[id]/comments', () => {
  let userSecretsQuery: any;
  let tasksUpdateQuery: any;

  beforeEach(() => {
    jest.clearAllMocks();

    userSecretsQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { daemon_secret_hash: 'secret-hash' }, error: null }),
    };

    tasksUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    mockCreateAdminDb.mockReturnValue({
      from: jest.fn((table: string) => (table === 'user_secrets' ? userSecretsQuery : tasksUpdateQuery)),
    });
  });

  describe('GET', () => {
    test('returns comments for a task', async () => {
      const mockTask = { id: 'task-1', user_id: LOCAL_USER_ID };
      mockGetTask.mockResolvedValue(mockTask);
      mockGetTaskComments.mockResolvedValue([
        { id: 'comment-1', task_id: 'task-1', content: 'hello', author_type: 'user', author_id: LOCAL_USER_ID },
      ]);

      const { GET } = await import('@/app/api/tasks/[id]/comments/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/comments');
      const response = await GET(request, { params: Promise.resolve({ id: 'task-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.comments).toEqual([
        expect.objectContaining({ id: 'comment-1', content: 'hello' }),
      ]);
    });
  });

  describe('POST', () => {
    test('adds a comment and re-signs the task when digest changes', async () => {
      const mockTask = {
        id: 'task-1',
        user_id: LOCAL_USER_ID,
        signature: 'old-signature',
        stage: 'ideation',
        engine: 'claude',
        content: '# Task',
        created_at: '2026-02-05T00:00:00.000Z',
      };
      mockGetTask.mockResolvedValue(mockTask);
      mockAddTaskComment.mockResolvedValue({ id: 'comment-2', content: 'new comment', task_id: 'task-1' });
      mockBuildTaskContext.mockResolvedValue({
        comments: [],
        learnings: { task: [], project: [], global: [] },
        stage_prompt: null,
        comments_digest: 'digest-123',
        project_context: null,
      });
      mockSignTask.mockReturnValue('new-signature');

      const { POST } = await import('@/app/api/tasks/[id]/comments/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'new comment' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'task-1' }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.comment).toEqual(expect.objectContaining({ id: 'comment-2', content: 'new comment' }));
      expect(data.comments_digest).toBe('digest-123');
      expect(data.signature).toBe('new-signature');
      expect(mockSignTask).toHaveBeenCalledWith(
        expect.objectContaining({ comments_digest: 'digest-123', id: 'task-1', user_id: LOCAL_USER_ID }),
        'secret-hash'
      );
      expect(tasksUpdateQuery.update).toHaveBeenCalledWith({ signature: 'new-signature' });
      expect(tasksUpdateQuery.eq).toHaveBeenCalledWith('id', 'task-1');
    });

    test('returns 400 when comment content is missing', async () => {
      const { POST } = await import('@/app/api/tasks/[id]/comments/route');
      const request = new NextRequest('http://localhost/api/tasks/task-1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'task-1' }) });

      expect(response.status).toBe(400);
    });
  });
});

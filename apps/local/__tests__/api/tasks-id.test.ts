/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const mockGetTask = jest.fn();
const mockUpdateTask = jest.fn();
const mockDeleteTask = jest.fn();
const mockBuildTaskContext = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();
const mockProjectTaskReadModel = jest.fn();

const mockParseFrontmatter = jest.fn((content: string) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  
  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body: match[2] };
});

jest.mock('@/lib/db-instance', () => ({
  db: {
    getTask: mockGetTask,
    updateTask: mockUpdateTask,
    deleteTask: mockDeleteTask,
  },
}));

jest.mock('@/lib/db', () => ({
  parseFrontmatter: mockParseFrontmatter,
  resolveTaskConfig: jest.fn((task, config) => ({
    provider: task.provider || config?.provider || 'gemini',
    model: task.model || config?.model || '',
    swarm: task.swarm ?? config?.swarm ?? false,
    swarm_models: task.swarm_models || config?.swarm_models || [],
  })),
}));

jest.mock('@/lib/task-context', () => ({
  buildTaskContext: mockBuildTaskContext,
}));

jest.mock('@/src/graph/read-path', () => ({
  projectTaskReadModel: (...args: unknown[]) => mockProjectTaskReadModel(...args),
}));

jest.mock('@/lib/db-adapter', () => ({
  createAdminDbClient: mockCreateServerDbWithRequest,
}));

const TASK_UUID = '00000000-0000-0000-0000-000000000001';

describe('/api/tasks/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
      },
    });
    mockBuildTaskContext.mockResolvedValue({
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_prompt: null,
      comments_digest: '',
      project_context: null,
    });
    mockProjectTaskReadModel.mockImplementation(async (task: unknown) => task);
  });

  describe('GET', () => {
    test('returns 400 for invalid task id sentinel values', async () => {
      const { GET } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest('http://localhost/api/tasks/%5Bobject%20Object%5D');
      const response = await GET(request, { params: Promise.resolve({ id: '[object Object]' }) });

      expect(response.status).toBe(400);
      expect(mockGetTask).not.toHaveBeenCalled();
    });

    test('returns task when found', async () => {
      const mockTask = { id: TASK_UUID, content: '# Test Task', title: 'Test Task' };
      mockGetTask.mockResolvedValue(mockTask);
      const context = {
        comments: [{ id: 'comment-1', task_id: TASK_UUID, author_type: 'user', content: 'ctx' }],
        learnings: { task: [], project: [], global: [] },
        stage_prompt: 'stage text',
        comments_digest: 'digest-xyz',
        project_context: null,
      };
      mockBuildTaskContext.mockResolvedValue(context);

      const { GET } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`);
      const response = await GET(request, { params: Promise.resolve({ id: TASK_UUID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockBuildTaskContext).toHaveBeenCalledWith(mockTask);
      expect(data.task).toMatchObject({
        ...mockTask,
        comments_digest: context.comments_digest,
        stage_prompt: context.stage_prompt,
      });
      expect(data.task.comments).toEqual(context.comments);
      expect(data.task.learnings).toEqual(context.learnings);
    });

    test('returns 404 when task not found', async () => {
      mockGetTask.mockResolvedValue(null);

      const { GET } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest('http://localhost/api/tasks/99999999-9999-9999-9999-999999999999');
      const response = await GET(request, { params: Promise.resolve({ id: '99999999-9999-9999-9999-999999999999' }) });

      expect(response.status).toBe(404);
    });

    test('handles errors gracefully', async () => {
      mockGetTask.mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`);
      const response = await GET(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT', () => {
    test('updates task with full content replacement', async () => {
      const newContent = '---\nstage: coding\n---\n# Updated Task';
      const updatedTask = { id: TASK_UUID, content: newContent, title: 'Updated Task' };
      mockUpdateTask.mockResolvedValue(updatedTask);

      const { PUT } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PUT',
        body: JSON.stringify({ content: newContent }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PUT(request, { params: Promise.resolve({ id: TASK_UUID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.task).toEqual(updatedTask);
    });

    test('returns 400 when content is missing', async () => {
      const { PUT } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PUT(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(400);
    });

    test('handles errors gracefully', async () => {
      mockUpdateTask.mockRejectedValue(new Error('Database error'));

      const { PUT } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PUT',
        body: JSON.stringify({ content: '# Test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PUT(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(500);
    });
  });

  describe('PATCH', () => {
    test('updates task stage', async () => {
      const originalTask = {
        id: TASK_UUID,
        content: '---\nstage: ideation\nstatus: queued\n---\n# Task',
      };
      mockGetTask.mockResolvedValue(originalTask);
      mockUpdateTask.mockResolvedValue({ ...originalTask, stage: 'planning' });

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'planning' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(200);
      expect(mockUpdateTask).toHaveBeenCalled();
    });

    test('maps PROGRESS stage alias to execution', async () => {
      const originalTask = {
        id: TASK_UUID,
        content: '---\nstage: done\nstatus: completed\n---\n# Task',
      };
      mockGetTask.mockResolvedValue(originalTask);
      mockUpdateTask.mockResolvedValue({ ...originalTask, stage: 'execution', status: 'in_progress' });

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'PROGRESS', status: 'in_progress' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(200);
      const updatePayload = mockUpdateTask.mock.calls[0]?.[1] as string;
      expect(updatePayload).toContain('stage: PROGRESS');
    });

    test('updates task status', async () => {
      const originalTask = {
        id: TASK_UUID,
        content: '---\nstage: coding\nstatus: queued\n---\n# Task',
      };
      mockGetTask.mockResolvedValue(originalTask);
      mockUpdateTask.mockResolvedValue({ ...originalTask, status: 'in_progress' });

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(200);
    });

    test('returns 400 for invalid status override', async () => {
      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'not_a_status' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(400);
      expect(mockGetTask).not.toHaveBeenCalled();
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    test('returns 400 for invalid stage override', async () => {
      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'invalid/stage' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(400);
      expect(mockGetTask).not.toHaveBeenCalled();
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    test('updates task priority', async () => {
      const originalTask = {
        id: TASK_UUID,
        content: '---\npriority: 0\n---\n# Task',
      };
      mockGetTask.mockResolvedValue(originalTask);
      mockUpdateTask.mockResolvedValue({ ...originalTask, priority: 5 });

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: 5 }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(200);
    });

    test('updates multiple fields at once', async () => {
      const originalTask = {
        id: TASK_UUID,
        content: '---\nstage: ideation\nstatus: queued\npriority: 0\n---\n# Task',
      };
      mockGetTask.mockResolvedValue(originalTask);
      mockUpdateTask.mockResolvedValue({
        ...originalTask,
        stage: 'coding',
        status: 'in_progress',
        priority: 2,
      });

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'coding', status: 'in_progress', priority: 2 }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(200);
    });

    test('returns 404 when task not found', async () => {
      mockGetTask.mockResolvedValue(null);

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest('http://localhost/api/tasks/99999999-9999-9999-9999-999999999999', {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'coding' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: '99999999-9999-9999-9999-999999999999' }) });

      expect(response.status).toBe(404);
    });

    test('handles errors gracefully', async () => {
      mockGetTask.mockRejectedValue(new Error('Database error'));

      const { PATCH } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'coding' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    test('deletes task successfully', async () => {
      mockDeleteTask.mockResolvedValue(undefined);

      const { DELETE } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, { method: 'DELETE' });
      const response = await DELETE(request, { params: Promise.resolve({ id: TASK_UUID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('handles errors gracefully', async () => {
      mockDeleteTask.mockRejectedValue(new Error('Database error'));

      const { DELETE } = await import('@/app/api/tasks/[id]/route');
      const request = new NextRequest(`http://localhost/api/tasks/${TASK_UUID}`, { method: 'DELETE' });
      const response = await DELETE(request, { params: Promise.resolve({ id: TASK_UUID }) });

      expect(response.status).toBe(500);
    });
  });
});

/**
 * @jest-environment node
 */

// Tests for /api/tasks endpoints

import { NextRequest } from 'next/server';

// Mock db module
const mockGetTasks = jest.fn();
const mockGetTask = jest.fn();
const mockCreateTask = jest.fn();
const mockBuildTaskContext = jest.fn();
const mockCreateAdminDb = jest.fn();
const mockStartTaskWorkflow = jest.fn().mockResolvedValue({ workflowId: 'task:new-task', runId: 'run-1', alreadyRunning: false });
const mockDualWriteTaskCreation = jest.fn();
const mockProjectTaskReadModel = jest.fn();
const mockProjectTaskReadModels = jest.fn();

jest.mock('@/lib/auth-mode', () => ({
  LOCAL_USER: {
    id: '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
    email: 'local@agx.board',
  },
}));

jest.mock('@/lib/db-instance', () => ({
  db: {
    getTasks: mockGetTasks,
    getTask: mockGetTask,
    createTask: mockCreateTask,
  },
}));

jest.mock('@/lib/db', () => ({
  parseFrontmatter: jest.fn((content: string) => ({ frontmatter: {}, body: content })),
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

// Mock db
const mockGetUser = jest.fn();

jest.mock('@/lib/db-server', () => ({
  createDbServerClientWithRequest: jest.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

jest.mock('@/lib/task-context', () => ({
  buildTaskContext: mockBuildTaskContext,
}));

jest.mock('@/src/graph/dual-write', () => ({
  dualWriteTaskCreation: (...args: unknown[]) => mockDualWriteTaskCreation(...args),
}));

jest.mock('@/src/graph/read-path', () => ({
  projectTaskReadModel: (...args: unknown[]) => mockProjectTaskReadModel(...args),
  projectTaskReadModels: (...args: unknown[]) => mockProjectTaskReadModels(...args),
}));

jest.mock('@/lib/security', () => ({
  signTask: jest.fn().mockReturnValue('mock-signature'),
  writeAuditLog: jest.fn().mockResolvedValue('audit-id'),
  detectDangerousOperations: jest.fn().mockReturnValue({ isDangerous: false, patterns: [], severity: 'low' }),
}));

jest.mock('@/lib/temporal/service', () => ({
  startTaskWorkflow: (...args: unknown[]) => mockStartTaskWorkflow(...args),
}));

describe('/api/tasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTask.mockResolvedValue({
      id: 'new-task',
      title: 'Test Task',
      status: 'queued',
      blocked_reason: null,
      content: '# Task',
      depends_on: [],
      user_id: '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    mockCreateAdminDb.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { daemon_secret_hash: 'secret-hash' }, error: null }),
      })),
    });
    mockBuildTaskContext.mockResolvedValue({
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_prompt: null,
      comments_digest: 'digest-123',
      project_context: null,
    });
    mockDualWriteTaskCreation.mockResolvedValue({
      enabled: true,
      result: 'created',
      graphId: 'graph-new-task',
    });
    mockProjectTaskReadModel.mockImplementation(async (task: unknown) => task);
    mockProjectTaskReadModels.mockImplementation(async (tasks: unknown) => tasks);
    mockStartTaskWorkflow.mockResolvedValue({ workflowId: 'task:new-task', runId: 'run-1', alreadyRunning: false });
  });

  describe('GET /api/tasks', () => {
    test('returns tasks list for authenticated user (LOCAL_USER)', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', stage: 'ideation' },
        { id: 'task-2', title: 'Task 2', stage: 'coding' },
      ];
      mockGetTasks.mockResolvedValue(mockTasks);

      const { GET } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toEqual(mockTasks);
      expect(mockGetTasks).toHaveBeenCalledWith('2c3cc1ca-956d-4b62-b295-4d2d3374103f', expect.any(Object));
    });

    test('filters by project when query param provided', async () => {
      mockGetTasks.mockResolvedValue([]);

      const { GET } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks?project=my-project');
      await GET(request);

      expect(mockGetTasks).toHaveBeenCalledWith(
        '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
        expect.objectContaining({ project: 'my-project' })
      );
    });

    test('filters by status when query param provided', async () => {
      mockGetTasks.mockResolvedValue([]);

      const { GET } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks?status=queued');
      await GET(request);

      expect(mockGetTasks).toHaveBeenCalledWith(
        '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
        expect.objectContaining({ status: 'queued' })
      );
    });

    test('filters orphan tasks when query param provided', async () => {
      mockGetTasks.mockResolvedValue([]);

      const { GET } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks?orphan=1');
      await GET(request);

      expect(mockGetTasks).toHaveBeenCalledWith(
        '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
        expect.objectContaining({ orphan: true })
      );
    });
  });

  describe('POST /api/tasks', () => {
    test('creates task with valid content', async () => {
      const newTask = { 
        id: 'new-task', 
        content: '# Test Task\nDescription',
        title: 'Test Task',
        stage: 'ideation',
        status: 'queued',
        created_at: new Date().toISOString(),
        user_id: '2c3cc1ca-956d-4b62-b295-4d2d3374103f',
      };
      mockCreateTask.mockResolvedValue(newTask);

      const { POST } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ content: '# Test Task\nDescription' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.task.title).toBe('Test Task');
      expect(data.graph_dual_write).toMatchObject({ result: 'created' });
      expect(mockDualWriteTaskCreation).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-task' }));
      const { signTask } = await import('@/lib/security');
      expect(signTask).toHaveBeenCalledWith(
        expect.objectContaining({ comments_digest: 'digest-123', id: 'new-task', user_id: '2c3cc1ca-956d-4b62-b295-4d2d3374103f' }),
        'secret-hash'
      );
    });

    test('returns 400 for missing content', async () => {
      const { POST } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    test('blocks critical dangerous operations', async () => {
      const { detectDangerousOperations } = await import('@/lib/security');
      (detectDangerousOperations as jest.Mock).mockReturnValueOnce({
        isDangerous: true,
        severity: 'critical',
        patterns: ['rm -rf /'],
      });

      const { POST } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ content: 'rm -rf /' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.dangerous).toBe(true);
    });

    test('allows non-critical dangerous operations with warning', async () => {
      const { detectDangerousOperations } = await import('@/lib/security');
      (detectDangerousOperations as jest.Mock).mockReturnValueOnce({
        isDangerous: true,
        severity: 'medium',
        patterns: ['password'],
      });

      const newTask = { 
        id: 'task-1',
        content: 'password = x',
        title: 'Task',
        created_at: new Date().toISOString(),
      };
      mockCreateTask.mockResolvedValue(newTask);

      const { POST } = await import('@/app/api/tasks/route');
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ content: 'password = x' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.warning).toBeDefined();
      expect(data.warning.severity).toBe('medium');
    });
  });
});

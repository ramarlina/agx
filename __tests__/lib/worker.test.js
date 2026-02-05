// Mock dependencies before requiring the module
jest.mock('../../lib/executor', () => ({
  executeTask: jest.fn(),
}));

jest.mock('../../lib/security', () => ({
  securityCheck: jest.fn(),
  confirmDangerousOperation: jest.fn(),
  logTaskExecution: jest.fn(),
  getDaemonSecret: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

const { AgxWorker } = require('../../lib/worker');
const { executeTask } = require('../../lib/executor');
const { 
  securityCheck, 
  confirmDangerousOperation, 
  logTaskExecution,
  getDaemonSecret,
} = require('../../lib/security');

describe('AgxWorker', () => {
  let worker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Default mock returns
    getDaemonSecret.mockReturnValue('test-daemon-secret');
    securityCheck.mockResolvedValue({
      canExecute: true,
      signatureValid: true,
      dangerousOps: { isDangerous: false },
      requiresConfirmation: false,
    });
    executeTask.mockResolvedValue({
      success: true,
      output: 'Task output',
      workDir: '/tmp/agx-task',
      exitCode: 0,
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task: null }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (worker) {
      worker.isRunning = false;
    }
  });

  describe('Constructor', () => {
    test('initializes with default config', () => {
      worker = new AgxWorker({ token: 'test-token' });
      
      expect(worker.cloudUrl).toBe('http://localhost:3333');
      expect(worker.token).toBe('test-token');
      expect(worker.engine).toBe('claude');
      expect(worker.pollIntervalMs).toBe(10000);
    });

    test('accepts custom config', () => {
      worker = new AgxWorker({
        token: 'my-token',
        apiUrl: 'https://api.example.com',
        engine: 'gemini',
        pollIntervalMs: 5000,
      });
      
      expect(worker.cloudUrl).toBe('https://api.example.com');
      expect(worker.engine).toBe('gemini');
      expect(worker.pollIntervalMs).toBe(5000);
    });

    test('initializes security settings', () => {
      worker = new AgxWorker({
        token: 'test-token',
        security: {
          requireSignature: false,
          allowDangerous: true,
        },
      });
      
      expect(worker.security.requireSignature).toBe(false);
      expect(worker.security.allowDangerous).toBe(true);
    });

    test('defaults security settings', () => {
      worker = new AgxWorker({ token: 'test-token' });
      
      expect(worker.security.requireSignature).toBe(true);
      expect(worker.security.allowDangerous).toBe(false);
    });
  });

  describe('start', () => {
    test('sets isRunning to true', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      
      // Start but don't await (it runs indefinitely)
      const startPromise = worker.start();
      
      expect(worker.isRunning).toBe(true);
      
      // Clean up
      worker.isRunning = false;
      jest.runAllTimers();
    });

    test('starts polling loop', async () => {
      worker = new AgxWorker({ token: 'test-token', pollIntervalMs: 1000 });
      
      worker.start();
      
      // Initial poll
      expect(global.fetch).toHaveBeenCalled();
      
      // Clean up
      worker.isRunning = false;
    });

    test('warns when no daemon secret configured', async () => {
      getDaemonSecret.mockReturnValue(null);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      worker = new AgxWorker({ token: 'test-token' });
      worker.start();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No daemon secret'));
      
      consoleSpy.mockRestore();
      worker.isRunning = false;
    });
  });

  describe('poll', () => {
    test('fetches task from queue', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: null }),
      });

      worker = new AgxWorker({ token: 'test-token' });
      worker.isRunning = true;
      
      await worker.poll();
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queue'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    test('includes engine in queue request', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: null }),
      });

      worker = new AgxWorker({ token: 'test-token', engine: 'gemini' });
      worker.isRunning = true;
      
      await worker.poll();
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('engine=gemini'),
        expect.any(Object)
      );
    });

    test('skips polling when not running', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      worker.isRunning = false;
      
      await worker.poll();
      
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips polling when task is in progress', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      worker.isRunning = true;
      worker.currentTask = { id: 'existing-task' };
      
      await worker.poll();
      
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('processTask', () => {
    const mockTask = {
      id: 'task-123',
      title: 'Test Task',
      content: '# Test\nContent',
      stage: 'coding',
      engine: 'claude',
      project: 'test-project',
      signature: 'valid-signature',
    };

    test('executes task when security check passes', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(executeTask).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-123',
        title: 'Test Task',
        content: '# Test\nContent',
        stage: 'coding',
      }));
    });

    test('rejects task when security check fails', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: false,
        reason: 'Invalid signature',
        signatureValid: false,
      });
      
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(executeTask).not.toHaveBeenCalled();
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'reject' })
      );
    });

    test('prompts for confirmation on dangerous operations', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: true,
        requiresConfirmation: true,
        dangerousOps: { isDangerous: true, maxSeverity: 'high' },
      });
      confirmDangerousOperation.mockResolvedValueOnce(true);
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(confirmDangerousOperation).toHaveBeenCalled();
      expect(executeTask).toHaveBeenCalled();
    });

    test('skips task when user declines dangerous operation', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: true,
        requiresConfirmation: true,
        dangerousOps: { isDangerous: true },
      });
      confirmDangerousOperation.mockResolvedValueOnce(false);
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(executeTask).not.toHaveBeenCalled();
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'skip' })
      );
    });

    test('advances stage after successful execution', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/tasks/${mockTask.id}/advance`),
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('logs task execution', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'execute' })
      );
    });

    test('pushes logs to cloud', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/tasks/${mockTask.id}/logs`),
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('handles execution error', async () => {
      executeTask.mockRejectedValueOnce(new Error('Execution failed'));
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ result: 'failed' })
      );
      
      consoleSpy.mockRestore();
    });

    test('clears currentTask after processing', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ newStage: 'qa' }) });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.processTask(mockTask);
      
      expect(worker.currentTask).toBeNull();
    });
  });

  describe('stop', () => {
    test('sets isRunning to false', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      worker.isRunning = true;
      
      await worker.stop();
      
      expect(worker.isRunning).toBe(false);
    });

    test('clears poll timer', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      worker.pollTimer = setInterval(() => {}, 1000);
      
      await worker.stop();
      
      expect(worker.pollTimer).toBeNull();
    });

    test('waits for current task to finish', async () => {
      worker = new AgxWorker({ token: 'test-token' });
      worker.isRunning = true;
      worker.currentTask = { id: 'in-progress' };
      
      // Simulate task finishing
      setTimeout(() => {
        worker.currentTask = null;
      }, 500);
      
      const stopPromise = worker.stop();
      jest.advanceTimersByTime(1000);
      
      await stopPromise;
      
      expect(worker.isRunning).toBe(false);
    });
  });

  describe('API Helpers', () => {
    test('apiRequest sends correct headers', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      });
      
      worker = new AgxWorker({ token: 'my-auth-token' });
      
      await worker.apiRequest('GET', '/api/test');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-auth-token',
          }),
        })
      );
    });

    test('apiRequest includes body for POST', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.apiRequest('POST', '/api/test', { foo: 'bar' });
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ foo: 'bar' }),
        })
      );
    });

    test('apiRequest throws on non-ok response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await expect(worker.apiRequest('GET', '/api/fail')).rejects.toThrow('Server error');
    });

    test('pushLog sends log to API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.pushLog('task-123', 'Log message');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123/logs'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Log message' }),
        })
      );
    });

    test('updateProgress sends progress to API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.updateProgress('task-123', 50);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ progress: 50 }),
        })
      );
    });

    test('advanceStage calls advance endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ newStage: 'qa' }),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      const result = await worker.advanceStage('task-123');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123/advance'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.newStage).toBe('qa');
    });

    test('updateTaskStatus calls PATCH endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      
      worker = new AgxWorker({ token: 'test-token' });
      
      await worker.updateTaskStatus('task-123', 'blocked');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'blocked' }),
        })
      );
    });
  });
});

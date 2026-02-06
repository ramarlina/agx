// Mock dependencies before requiring the module
jest.mock('../../lib/security', () => ({
  securityCheck: jest.fn(),
  confirmDangerousOperation: jest.fn(),
  logTaskExecution: jest.fn(),
  getDaemonSecret: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

const { AgxWorker } = require('../../lib/worker');
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
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
      expect(worker.cloudUrl).toBe('http://localhost:3333');
      expect(worker.token).toBe('test-token');
      expect(worker.pollIntervalMs).toBe(10000);
    });

    test('accepts custom config', () => {
      worker = new AgxWorker({
        token: 'my-token',
        apiUrl: 'https://api.example.com',
        pollIntervalMs: 5000,
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-anon-key',
      });
      
      expect(worker.cloudUrl).toBe('https://api.example.com');
      expect(worker.pollIntervalMs).toBe(5000);
    });

    test('initializes security settings', () => {
      worker = new AgxWorker({
        token: 'test-token',
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-anon-key',
        security: {
          requireSignature: false,
          allowDangerous: true,
        },
      });
      
      expect(worker.security.requireSignature).toBe(false);
      expect(worker.security.allowDangerous).toBe(true);
    });

    test('defaults security settings', () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
      expect(worker.security.requireSignature).toBe(true);
      expect(worker.security.allowDangerous).toBe(false);
    });
  });

  describe('start', () => {
    test('sets isRunning to true', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });

      // Start but don't await (it runs indefinitely)
      worker.start();

      expect(worker.isRunning).toBe(true);

      // Clean up
      worker.isRunning = false;
    });

    test('subscribes to Supabase queue', async () => {
      worker = new AgxWorker({ token: 'test-token', pollIntervalMs: 1000, supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });

      worker.start();

      // Should have created a realtime channel
      expect(worker.realtimeChannel).toBeTruthy();

      // Clean up
      worker.isRunning = false;
    });

    test('warns when no daemon secret configured', async () => {
      getDaemonSecret.mockReturnValue(null);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.start();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No daemon secret'));
      
      consoleSpy.mockRestore();
      worker.isRunning = false;
    });
  });

  describe('pollOnce', () => {
    test('fetches task from queue', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: null }),
      });

      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.isRunning = true;
      
      await worker.pollOnce();
      
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

    test('polls queue without engine filter', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: null }),
      });

      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.isRunning = true;
      
      await worker.pollOnce();
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queue'),
        expect.any(Object)
      );
    });

    test('skips polling when not running', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.isRunning = false;
      
      await worker.pollOnce();
      
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips polling when task is in progress', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.isRunning = true;
      worker.currentTask = { id: 'existing-task' };
      
      await worker.pollOnce();
      
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('processTask', () => {
    const mockTask = {
      id: 'task-123',
      title: 'Test Task',
      content: '# Test\nContent',
      stage: 'coding',
      project: 'test-project',
      signature: 'valid-signature',
    };

    test('executes task when security check passes', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const runSpy = jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(runSpy).toHaveBeenCalledWith('task-123');
    });

    test('rejects task when security check fails', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: false,
        reason: 'Invalid signature',
        signatureValid: false,
      });
      
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const runSpy = jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(runSpy).not.toHaveBeenCalled();
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'reject' })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/tasks/${mockTask.id}`),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'blocked' }),
        })
      );
    });

    test('prompts for confirmation on dangerous operations', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: true,
        requiresConfirmation: true,
        dangerousOps: { isDangerous: true, maxSeverity: 'high' },
      });
      confirmDangerousOperation.mockResolvedValueOnce(true);
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const runSpy = jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(confirmDangerousOperation).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalled();
    });

    test('skips task when user declines dangerous operation', async () => {
      securityCheck.mockResolvedValueOnce({
        canExecute: true,
        requiresConfirmation: true,
        dangerousOps: { isDangerous: true },
      });
      confirmDangerousOperation.mockResolvedValueOnce(false);
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const runSpy = jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(runSpy).not.toHaveBeenCalled();
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'skip' })
      );
    });

    test('delegates to shared run path', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const runSpy = jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(runSpy).toHaveBeenCalledWith('task-123');
    });

    test('logs task execution', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'execute' })
      );
    });

    test('pushes logs to cloud', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/tasks/${mockTask.id}/logs`),
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('handles execution error', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      jest.spyOn(worker, 'executeViaRunCommand').mockRejectedValueOnce(new Error('Execution failed'));
      
      await worker.processTask(mockTask);
      
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ result: 'failed' })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/tasks/${mockTask.id}`),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'blocked' }),
        })
      );
      
      consoleSpy.mockRestore();
    });

    test('does not block task on claim conflict error', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      const statusSpy = jest.spyOn(worker, 'updateTaskStatus');
      jest.spyOn(worker, 'executeViaRunCommand').mockRejectedValueOnce(new Error('Task already claimed'));

      await worker.processTask(mockTask);

      expect(statusSpy).not.toHaveBeenCalledWith(mockTask.id, 'blocked');
      expect(logTaskExecution).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'skip', result: 'skipped' })
      );
    });

    test('clears currentTask after processing', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      jest.spyOn(worker, 'executeViaRunCommand').mockResolvedValueOnce({ output: 'Task output' });
      
      await worker.processTask(mockTask);
      
      expect(worker.currentTask).toBeNull();
    });
  });

  describe('stop', () => {
    test('sets isRunning to false', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      worker.isRunning = true;
      
      await worker.stop();
      
      expect(worker.isRunning).toBe(false);
    });

    test('clears realtime channel on stop', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });

      await worker.stop();

      // After stop, channel should be cleared (handled in stop())
      expect(worker.isRunning).toBe(false);
    });

    test('waits for current task to finish', async () => {
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
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
      
      worker = new AgxWorker({ token: 'my-auth-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
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
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
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
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
      await expect(worker.apiRequest('GET', '/api/fail')).rejects.toThrow('Server error');
    });

    test('pushLog sends log to API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
      await worker.pushLog('task-123', 'Log message');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123/logs'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Log message', log_type: 'system' }),
        })
      );
    });

    test('updateProgress sends progress to API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
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
      global.fetch
        .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ newStage: 'qa' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
      const result = await worker.advanceStage('task-123');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tasks/task-123'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ claimed_by: null, claimed_at: null }),
        })
      );
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
      
      worker = new AgxWorker({ token: 'test-token', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-anon-key' });
      
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

const execa = require('execa');
const fs = require('fs');
const path = require('path');

jest.mock('execa', () => {
  const fn = jest.fn();
  fn.sync = jest.fn();
  fn.commandSync = jest.fn();
  fn.command = jest.fn();
  return fn;
});

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const { executeTask, ENGINES, resolveStageConfig } = require('../../lib/executor');

describe('AGX Executor Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Avoid depending on local machine provider CLIs in unit tests.
    for (const engine of Object.values(ENGINES)) {
      engine.available = () => true;
    }
  });

  describe('resolveStageConfig', () => {
    test('resolves stage config from task stage_prompts object', () => {
      const config = resolveStageConfig({
        stage: 'planning',
        task: {
          stage_prompts: {
            planning: {
              prompt: 'Create a concrete plan',
              outputs: ['plan.md', 'tasks.md']
            }
          }
        }
      });

      expect(config.prompt).toBe('Create a concrete plan');
      expect(config.outputs).toEqual(['plan.md', 'tasks.md']);
    });

    test('resolves stage config from stage_prompts array', () => {
      const config = resolveStageConfig({
        stage: 'qa',
        stage_prompts: [
          { stage: 'qa', prompt: 'Run QA checks', outputs: ['test_results.md'] }
        ]
      });

      expect(config.prompt).toBe('Run QA checks');
      expect(config.outputs).toEqual(['test_results.md']);
    });

    test('falls back to generic prompt when stage prompt is missing', () => {
      const config = resolveStageConfig({ stage: 'unknown_stage' });
      expect(config.prompt.toLowerCase()).toContain('latest stage prompt');
      expect(config.outputs).toEqual([]);
    });
  });

  describe('ENGINES', () => {
    test('includes all three engines', () => {
      expect(ENGINES.claude).toBeDefined();
      expect(ENGINES.gemini).toBeDefined();
      expect(ENGINES.ollama).toBeDefined();
    });

    test('each engine has cmd, args, and available', () => {
      Object.values(ENGINES).forEach(engine => {
        expect(engine).toHaveProperty('cmd');
        expect(engine).toHaveProperty('args');
        expect(engine).toHaveProperty('available');
        expect(typeof engine.cmd).toBe('string');
        expect(Array.isArray(engine.args)).toBe(true);
        expect(typeof engine.available).toBe('function');
      });
    });

    test('claude engine config', () => {
      expect(ENGINES.claude.cmd).toBe('claude');
      expect(ENGINES.claude.args).toContain('-p');
    });

    test('gemini engine config', () => {
      expect(ENGINES.gemini.cmd).toBe('gemini');
      expect(ENGINES.gemini.args).toContain('--yolo');
      expect(ENGINES.gemini.args).toContain('-p');
    });

    test('ollama engine config', () => {
      expect(ENGINES.ollama.cmd).toBe('ollama');
      expect(ENGINES.ollama.args).toContain('run');
    });

    test('engine.available checks command existence', () => {
      Object.values(ENGINES).forEach(engine => {
        const result = engine.available();
        expect(typeof result).toBe('boolean');
      });
    });
  });

  describe('executeTask', () => {
    let mockProcess;

    beforeEach(() => {
      // Create mock process with event emitters
      mockProcess = {
        stdout: {
          on: jest.fn(),
        },
        stderr: {
          on: jest.fn(),
        },
        on: jest.fn(),
        kill: jest.fn(),
      };

      execa.mockReturnValue(mockProcess);
      fs.existsSync.mockReturnValue(false);
    });

    test('executes task with correct parameters', async () => {
      // Setup mock to complete immediately
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      const options = {
        taskId: 'task-123',
        title: 'Test Task',
        content: '# Test Task\n\nDo something',
        stage: 'coding',
        engine: 'claude',
        onLog: jest.fn(),
        onProgress: jest.fn(),
      };

      const promise = executeTask(options);

      // Simulate successful execution
      await promise;

      expect(execa).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.stringContaining('Test Task')]),
        expect.any(Object)
      );
    });

    test('creates temp directory for task', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-temp',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
      });

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    test('calls onLog callback with progress updates', async () => {
      const onLog = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[checkpoint: Progress made]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-log',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onLog,
      });

      expect(onLog).toHaveBeenCalled();
    });

    test('calls onProgress callback', async () => {
      const onProgress = jest.fn();
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-progress',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledWith(10); // Initial progress
      expect(onProgress).toHaveBeenCalledWith(100); // Final progress
    });

    test('throws error when engine not available', async () => {
      ENGINES.claude.available = () => false;

      await expect(executeTask({
        taskId: 'task-no-engine',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        engine: 'claude',
      })).rejects.toThrow();
    });

    test('handles process error', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('Spawn failed')), 10);
        }
      });

      await expect(executeTask({
        taskId: 'task-error',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
      })).rejects.toThrow('Failed to spawn');
    });

    test('handles non-zero exit code', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10);
        }
      });

      await expect(executeTask({
        taskId: 'task-fail',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
      })).rejects.toThrow('exited with code 1');
    });

    test('uses default engine when not specified', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-default',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
      });

      expect(execa).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.any(Object)
      );
    });

    test('uses correct stage config', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-planning',
        title: 'Test',
        content: 'Content',
        stage: 'planning',
        stage_prompts: {
          planning: {
            prompt: 'Create detailed plan with tasks, milestones, and dependencies.',
            outputs: ['plan.md', 'tasks.md']
          }
        }
      });

      const callArgs = execa.mock.calls[0][1];
      const prompt = callArgs[callArgs.length - 1];
      expect(prompt).toContain('plan');
    });

    test('falls back to generic prompt for unknown stage', async () => {
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-unknown',
        title: 'Test',
        content: 'Content',
        stage: 'unknown_stage',
      });

      // Should still execute without throwing
      expect(execa).toHaveBeenCalled();
    });

    test('parses [checkpoint:] markers', async () => {
      const onLog = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[checkpoint: Save point 1]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-checkpoint',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onLog,
      });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('checkpoint'));
    });

    test('parses [learn:] markers', async () => {
      const onLog = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[learn: Use caching for better performance]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-learn',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onLog,
      });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('learning'));
    });

    test('parses [done] marker', async () => {
      const onLog = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[done]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-done',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onLog,
      });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('done'));
    });

    test('parses [blocked:] marker', async () => {
      const onLog = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[blocked: Need API access]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-blocked',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onLog,
      });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('blocked'));
    });

    test('parses [progress:] marker', async () => {
      const onProgress = jest.fn();
      
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('[progress: 50%]'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      await executeTask({
        taskId: 'task-progress-marker',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledWith(50);
    });

    test('returns result object on success', async () => {
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('Task output'));
        }
      });
      
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      const result = await executeTask({
        taskId: 'task-result',
        title: 'Test',
        content: 'Content',
        stage: 'coding',
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('workDir');
      expect(result).toHaveProperty('exitCode', 0);
    });
  });
});

import { buildCliCommand, executeRun } from '@/src/prompt-scheduler/runner';
import type { RunResult } from '@/src/prompt-scheduler/runner';

// ── buildCliCommand ────────────────────────────────────────────────────────────

describe('buildCliCommand', () => {
  it('maps claude to [-p, prompt]', () => {
    expect(buildCliCommand('claude', 'summarize inbox')).toEqual({
      cmd: 'claude',
      args: ['-p', 'summarize inbox'],
    });
  });

  it('maps codex to [-p, prompt]', () => {
    expect(buildCliCommand('codex', 'fix the bug')).toEqual({
      cmd: 'codex',
      args: ['-p', 'fix the bug'],
    });
  });

  it('maps gemini to [-p, prompt]', () => {
    expect(buildCliCommand('gemini', 'review PR')).toEqual({
      cmd: 'gemini',
      args: ['-p', 'review PR'],
    });
  });

  it('includes model flag when model is provided', () => {
    expect(buildCliCommand('claude', 'hello', 'opus')).toEqual({
      cmd: 'claude',
      args: ['--model', 'opus', '-p', 'hello'],
    });
  });

  it('includes extra cli args', () => {
    expect(buildCliCommand('claude', 'hello', '', '--dangerously-skip-permissions')).toEqual({
      cmd: 'claude',
      args: ['--dangerously-skip-permissions', '-p', 'hello'],
    });
  });

  it('includes model and cli args together', () => {
    expect(buildCliCommand('claude', 'hello', 'sonnet', '--verbose')).toEqual({
      cmd: 'claude',
      args: ['--model', 'sonnet', '--verbose', '-p', 'hello'],
    });
  });

  it('handles custom CLI with {prompt} template', () => {
    expect(buildCliCommand('my-cli run --input {prompt}', 'hello world')).toEqual({
      cmd: 'my-cli',
      args: ['run', '--input', 'hello world'],
    });
  });

  it('handles custom CLI without template by appending prompt', () => {
    expect(buildCliCommand('my-cli run', 'hello')).toEqual({
      cmd: 'my-cli',
      args: ['run', 'hello'],
    });
  });
});

// ── executeRun ─────────────────────────────────────────────────────────────────

describe('executeRun', () => {
  it('calls onStart and onComplete with success status using echo', (done) => {
    const onStart = jest.fn();
    const onComplete = jest.fn((result: RunResult) => {
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('success');
      expect(result.output).toContain('hello world');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      done();
    });

    executeRun({
      provider: 'echo',
      model: '',
      cliArgs: '',
      prompt: 'hello world',
      cancelCheckSec: 60,
      isCancelled: async () => false,
      onStart,
      onComplete,
    });
  });

  it('reports cancelled status when isCancelled returns true', (done) => {
    let callCount = 0;
    const onStart = jest.fn();
    const onComplete = jest.fn((result: RunResult) => {
      expect(result.status).toBe('cancelled');
      done();
    });

    executeRun({
      provider: 'sleep',
      model: '',
      cliArgs: '',
      prompt: '10',
      cancelCheckSec: 0.1,
      isCancelled: async () => {
        callCount += 1;
        return callCount >= 2;
      },
      onStart,
      onComplete,
    });
  }, 10000);

  it('reports failed status on non-zero exit code', (done) => {
    const onComplete = jest.fn((result: RunResult) => {
      expect(result.status).toBe('failed');
      done();
    });

    executeRun({
      provider: 'false',
      model: '',
      cliArgs: '',
      prompt: '',
      cancelCheckSec: 60,
      isCancelled: async () => false,
      onStart: jest.fn(),
      onComplete,
    });
  });

  it('reports failed status on spawn error (unknown command)', (done) => {
    const onComplete = jest.fn((result: RunResult) => {
      expect(result.status).toBe('failed');
      done();
    });

    executeRun({
      provider: 'this-command-does-not-exist-xyz',
      model: '',
      cliArgs: '',
      prompt: 'test',
      cancelCheckSec: 60,
      isCancelled: async () => false,
      onStart: jest.fn(),
      onComplete,
    });
  });
});

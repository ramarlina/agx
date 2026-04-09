/**
 * @jest-environment node
 */

import {
  AUTO_CHECKS,
  didRequiredChecksPass,
  executeCheck,
  executeChecks,
  executeCommandWithTimeout,
  type CommandExecutor,
} from '@/src/graph/checks';

function makeExecutor(
  impl: (command: string) => { exitCode: number | null; timedOut?: boolean; durationMs?: number },
): CommandExecutor {
  return async (command) => {
    const result = impl(command);
    return {
      exitCode: result.exitCode,
      stdout: '',
      stderr: '',
      durationMs: result.durationMs ?? 5,
      timedOut: result.timedOut ?? false,
    };
  };
}

describe('graph checks', () => {
  test('exposes the v2 auto-check registry keys', () => {
    expect(Object.keys(AUTO_CHECKS).sort()).toEqual([
      'build_success',
      'coverage_threshold',
      'lint_clean',
      'tests_pass',
      'types_valid',
    ]);
  });

  test('runs a check with command/timeout from the registry', async () => {
    const executor = jest.fn(
      makeExecutor(() => ({
        exitCode: 0,
      })),
    );

    const result = await executeCheck('tests_pass', { executor });

    expect(executor).toHaveBeenCalledWith(
      'npm test',
      expect.objectContaining({
        timeoutMs: 300000,
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.required).toBe(true);
  });

  test('marks timeout as failure even with zero exit code', async () => {
    const result = await executeCheck(
      'build_success',
      {
        executor: makeExecutor(() => ({
          exitCode: 0,
          timedOut: true,
        })),
      },
    );

    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.message).toContain('timed out');
  });

  test('skips unknown checks as optional', async () => {
    const results = await executeChecks(['unknown_check']);

    expect(results).toHaveLength(1);
    expect(results[0].required).toBe(false);
    expect(results[0].passed).toBe(false);
    expect(didRequiredChecksPass(results)).toBe(true);
  });

  test('enforces command timeout', async () => {
    const result = await executeCommandWithTimeout(
      `${process.execPath} -e "setTimeout(() => {}, 1000)"`,
      { timeoutMs: 25 },
    );

    expect(result.timedOut).toBe(true);
  });
});

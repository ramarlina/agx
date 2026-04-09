import { spawn } from 'node:child_process';

import type { CheckResult } from './types';
import {
  CHECK_NPM_TEST_TIMEOUT_MS,
  CHECK_NPM_LINT_TIMEOUT_MS,
  CHECK_NPM_COVERAGE_TIMEOUT_MS,
  CHECK_NPM_BUILD_TIMEOUT_MS,
  CHECK_NPM_TYPECHECK_TIMEOUT_MS,
} from '@/lib/constants/timing';

export type AutoCheckName =
  | 'tests_pass'
  | 'lint_clean'
  | 'coverage_threshold'
  | 'build_success'
  | 'types_valid';

export interface CheckDefinition {
  command: string;
  timeout: number;
  required: boolean;
}

export interface ExecutedCheckResult extends CheckResult {
  required: boolean;
  command: string;
  timeoutMs: number;
  timedOut: boolean;
  exitCode: number | null;
}

export interface CommandExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export type CommandExecutor = (
  command: string,
  options: CommandExecutionOptions,
) => Promise<CommandExecutionResult>;

export interface RunChecksOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  executor?: CommandExecutor;
}

export const AUTO_CHECKS: Readonly<Record<AutoCheckName, CheckDefinition>> = {
  tests_pass: {
    command: 'npm test',
    timeout: CHECK_NPM_TEST_TIMEOUT_MS,
    required: true,
  },
  lint_clean: {
    command: 'npm run lint',
    timeout: CHECK_NPM_LINT_TIMEOUT_MS,
    required: false,
  },
  coverage_threshold: {
    command: 'npm run coverage',
    timeout: CHECK_NPM_COVERAGE_TIMEOUT_MS,
    required: true,
  },
  build_success: {
    command: 'npm run build',
    timeout: CHECK_NPM_BUILD_TIMEOUT_MS,
    required: true,
  },
  types_valid: {
    command: 'npm run typecheck',
    timeout: CHECK_NPM_TYPECHECK_TIMEOUT_MS,
    required: true,
  },
};

function isKnownAutoCheck(checkName: string): checkName is AutoCheckName {
  return Object.prototype.hasOwnProperty.call(AUTO_CHECKS, checkName);
}

function normalizeUnknownCheckResult(checkName: string): ExecutedCheckResult {
  return {
    check: checkName,
    passed: false,
    message: `Unknown auto-check '${checkName}' was skipped`,
    required: false,
    command: '',
    timeoutMs: 0,
    timedOut: false,
    exitCode: null,
  };
}

export async function executeCommandWithTimeout(
  command: string,
  options: CommandExecutionOptions,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimeout = setTimeout(() => {
        if (!done) {
          child.kill('SIGKILL');
        }
      }, 500);
      forceKillTimeout.unref?.();
    }, Math.max(1, options.timeoutMs));
    timeout.unref?.();

    const finalize = (exitCode: number | null) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    child.stdout?.on('data', (data: Buffer | string) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer | string) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      stderr += error.message;
      finalize(1);
    });
    child.on('close', (code) => {
      finalize(code);
    });
  });
}

export async function executeCheck(
  checkName: string,
  options: RunChecksOptions = {},
): Promise<ExecutedCheckResult> {
  if (!isKnownAutoCheck(checkName)) {
    return normalizeUnknownCheckResult(checkName);
  }

  const definition = AUTO_CHECKS[checkName];
  const executor = options.executor ?? executeCommandWithTimeout;
  const execution = await executor(definition.command, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: definition.timeout,
  });
  const passed = execution.exitCode === 0 && !execution.timedOut;

  const message = execution.timedOut
    ? `Check timed out after ${definition.timeout}ms`
    : passed
      ? `Check passed (${definition.command})`
      : `Check failed with exit code ${execution.exitCode ?? 'null'}`;

  return {
    check: checkName,
    passed,
    message,
    latencyMs: execution.durationMs,
    details: {
      stdout: execution.stdout,
      stderr: execution.stderr,
    },
    required: definition.required,
    command: definition.command,
    timeoutMs: definition.timeout,
    timedOut: execution.timedOut,
    exitCode: execution.exitCode,
  };
}

export async function executeChecks(
  checkNames: readonly string[],
  options: RunChecksOptions = {},
): Promise<ExecutedCheckResult[]> {
  const results: ExecutedCheckResult[] = [];

  for (const checkName of checkNames) {
    const result = await executeCheck(checkName, options);
    results.push(result);
  }

  return results;
}

export function didRequiredChecksPass(results: readonly ExecutedCheckResult[]): boolean {
  return results.every((result) => !result.required || result.passed);
}

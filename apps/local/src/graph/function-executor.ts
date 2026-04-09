import { spawn } from 'child_process';
import type { FunctionNode, ExecutionGraph } from './types';
import { dispatchInternalFunction } from './internal-function-dispatcher';

export interface FunctionDispatchResult {
  status: 'success' | 'failure';
  output?: Record<string, unknown>;
  message?: string;
  error?: unknown;
}

/**
 * Maximum stdout buffer size (64KB) to prevent runaway endpoints from eating memory.
 */
const MAX_STDOUT_BYTES = 64 * 1024;

/**
 * Execute a bash function node by running the command and parsing JSON stdout.
 *
 * Invariants:
 * - Command is executed with timeout
 * - Stdout is capped at MAX_STDOUT_BYTES
 * - JSON output is parsed and stored in node.output
 * - On timeout, non-zero exit, or malformed output: status=failure
 */
export async function dispatchBashFunction(
  node: FunctionNode,
  _graph: ExecutionGraph,
): Promise<FunctionDispatchResult> {
  if (node.kind !== 'bash') {
    return {
      status: 'failure',
      message: `Unsupported function node kind: ${node.kind}`,
    };
  }

  const command = node.command;
  if (!command || command.trim() === '') {
    return {
      status: 'failure',
      message: 'Empty command',
    };
  }

  const timeoutMs = node.timeoutMs ?? 30000;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let truncated = false;
    let killed = false;

    const proc = spawn(command, [], {
      shell: true,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      if (truncated) return;

      const chunkBytes = Buffer.byteLength(chunk.toString(), 'utf8');
      if (stdoutBytes + chunkBytes > MAX_STDOUT_BYTES) {
        truncated = true;
        return;
      }

      stdout += chunk.toString();
      stdoutBytes += chunkBytes;
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        status: 'failure',
        message: `Failed to spawn command: ${err.message}`,
        error: err,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        resolve({
          status: 'failure',
          message: `Command timed out after ${timeoutMs}ms`,
        });
        return;
      }

      if (truncated) {
        resolve({
          status: 'failure',
          message: `Stdout exceeded ${MAX_STDOUT_BYTES} bytes limit`,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          status: 'failure',
          message: `Command exited with code ${code}: ${stderr || '(no stderr)'}`,
        });
        return;
      }

      // Parse stdout — try JSON first, fall back to raw text
      const trimmed = stdout.trim();
      if (trimmed === '') {
        resolve({ status: 'success', output: {} });
        return;
      }

      try {
        const output = JSON.parse(trimmed) as Record<string, unknown>;
        resolve({ status: 'success', output });
      } catch {
        // Non-JSON output is fine — store as raw text
        resolve({ status: 'success', output: { raw: trimmed } });
      }
    });
  });
}

/**
 * Create a dispatchFunction implementation that handles both bash and (future) MCP.
 * Currently only bash is supported.
 */
export function createDispatchFunction(): (
  node: FunctionNode,
  graph: ExecutionGraph,
) => Promise<FunctionDispatchResult> {
  return async (node, graph) => {
    switch (node.kind) {
      case 'bash':
        return dispatchBashFunction(node, graph);
      case 'internal':
        return dispatchInternalFunction(node, graph);
      default:
        return {
          status: 'failure',
          message: `Unsupported function node kind: ${node.kind}`,
        };
    }
  };
}

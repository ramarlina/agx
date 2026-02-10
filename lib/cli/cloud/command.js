/* eslint-disable no-console */
'use strict';

function createCloudCommandHelpers(env) {
  const {
    loadCloudConfigFile,
    fetch,
    sanitizeCliArgs,
    logExecutionFlow,
    spawnCloudTaskProcess,
    randomId,
    appendTail,
    truncateForTemporalTrace,
    extractCancellationReason,
    CancellationRequestedError,
    CANCELLED_ERROR_CODE,
  } = env || {};

  async function updateCloudTask(taskId, updates) {
    const cloudConfig = loadCloudConfigFile();
    if (!cloudConfig?.apiUrl) return;
    if (!taskId) return;

    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-user-id': cloudConfig.userId || '',
      };
      if (cloudConfig?.token) {
        headers.Authorization = `Bearer ${cloudConfig.token}`;
      }
      // Assume standard API route is /api/tasks/:id
      await fetch(`${cloudConfig.apiUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates),
      });
    } catch (err) {
      // Silent fail or log debug
      // console.debug('Failed to update cloud task', err);
    }
  }

  function runAgxCommand(args, timeoutMs, label, handlers = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let stdoutTail = '';
      let stderrTail = '';
      let settled = false;

      const childArgs = sanitizeCliArgs([process.argv[1], ...args]);
      logExecutionFlow('runAgxCommand', 'input', `label=${label}, args=${childArgs.join(' ')}, timeout=${timeoutMs}`);
      const cancellationWatcher = handlers.cancellationWatcher || null;
      const child = spawnCloudTaskProcess(childArgs);
      logExecutionFlow('runAgxCommand', 'processing', `spawning child process (pid: ${child.pid})`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const traceId = randomId();
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      const emitTrace = (event) => {
        if (!handlers || typeof handlers.onTrace !== 'function') return;
        try {
          handlers.onTrace(event);
        } catch { }
      };

      emitTrace({
        id: traceId,
        phase: 'start',
        label,
        args: childArgs,
        pid: child?.pid || null,
        timeout_ms: timeoutMs,
        started_at: startedAtIso,
      });

      if (cancellationWatcher?.start) {
        try {
          cancellationWatcher.start();
        } catch { }
      }

      let cancelUnsubscribe = null;
      const cleanupCancellation = () => {
        if (cancelUnsubscribe) {
          cancelUnsubscribe();
          cancelUnsubscribe = null;
        }
      };

      const handleCancellation = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (child && typeof child.kill === 'function') {
          child.kill('SIGTERM');
          setTimeout(() => {
            child.kill('SIGKILL');
          }, 500);
        }
        const reason = extractCancellationReason(payload) || 'Cancelled by operator';
        const err = new CancellationRequestedError(reason);
        err.code = CANCELLED_ERROR_CODE;
        err.payload = payload;
        err.stdout = stdout;
        err.stderr = stderr;
        emitTrace({
          id: traceId,
          phase: 'cancel',
          label,
          args: childArgs,
          pid: child?.pid || null,
          timeout_ms: timeoutMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          stdout_tail: truncateForTemporalTrace(stdoutTail),
          stderr_tail: truncateForTemporalTrace(stderrTail),
          error: err.message,
        });
        cleanupCancellation();
        reject(err);
      };

      if (cancellationWatcher?.onCancel) {
        cancelUnsubscribe = cancellationWatcher.onCancel(handleCancellation);
      }

      controller.signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        const err = new Error(`${label || 'command'} timed out`);
        err.code = 'ETIMEDOUT';
        clearTimeout(timeout);
        emitTrace({
          id: traceId,
          phase: 'timeout',
          label,
          args: childArgs,
          pid: child?.pid || null,
          timeout_ms: timeoutMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          stdout_tail: truncateForTemporalTrace(stdoutTail),
          stderr_tail: truncateForTemporalTrace(stderrTail),
          error: err.message,
        });
        cleanupCancellation();
        reject(err);
      });

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        stdoutTail = appendTail(stdoutTail, chunk);
        if (handlers.onStdout) handlers.onStdout(data);
      });
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        stderrTail = appendTail(stderrTail, chunk);
        if (handlers.onStderr) handlers.onStderr(data);
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        logExecutionFlow('runAgxCommand', 'output', `error ${err?.message || err}`);
        emitTrace({
          id: traceId,
          phase: 'error',
          label,
          args: childArgs,
          pid: child?.pid || null,
          timeout_ms: timeoutMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          stdout_tail: truncateForTemporalTrace(stdoutTail),
          stderr_tail: truncateForTemporalTrace(stderrTail),
          error: err?.message || String(err),
        });
        cleanupCancellation();
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        logExecutionFlow('runAgxCommand', 'output', `pid=${child.pid}, exit code=${code}`);
        emitTrace({
          id: traceId,
          phase: 'exit',
          label,
          args: childArgs,
          pid: child?.pid || null,
          timeout_ms: timeoutMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          exit_code: code,
          stdout_tail: truncateForTemporalTrace(stdoutTail),
          stderr_tail: truncateForTemporalTrace(stderrTail),
        });
        cleanupCancellation();
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          const err = new Error(`${label || 'command'} exited with code ${code}`);
          err.code = code;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        }
      });
    });
  }

  return { updateCloudTask, runAgxCommand };
}

module.exports = { createCloudCommandHelpers };


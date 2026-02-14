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
    scheduleTermination,
    getProcessManager,
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

  // WARNING: Behavior in this function is intentionally lock-tested.
  // Do not alter command argument wiring (including pass-through flags like `-y`)
  // without updating the companion tests and completing a safety review.
  function runAgxCommand(args, timeoutMs, label, handlers = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let stdoutTail = '';
      let stderrTail = '';
      let settled = false;
      let killHandle = null;

      const childArgs = sanitizeCliArgs([process.argv[1], ...args]);
      logExecutionFlow('runAgxCommand', 'input', `label=${label}, args=${childArgs.join(' ')}, timeout=${timeoutMs}`);
      const cancellationWatcher = handlers.cancellationWatcher || null;
      const child = spawnCloudTaskProcess(childArgs, {
        cwd: handlers.cwd,
        env: handlers.env,
      });
      logExecutionFlow('runAgxCommand', 'processing', `spawning child process (pid: ${child.pid})`);
      const childPid = child?.pid || null;

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

      const killChild = () => {
        if (!childPid) return;
        if (killHandle) return;
        try {
          killHandle = scheduleTermination(childPid, { graceMs: 800, forceMs: 2500 });
        } catch { }
      };

      const handleCancellation = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        killChild();
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
        killChild();
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

      const pm = typeof getProcessManager === 'function' ? getProcessManager() : null;

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        stdoutTail = appendTail(stdoutTail, chunk);
        if (pm && childPid) pm.recordActivity(childPid);
        if (handlers.onStdout) handlers.onStdout(data);
      });
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        stderrTail = appendTail(stderrTail, chunk);
        if (pm && childPid) pm.recordActivity(childPid);
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
        try { killHandle?.cancel?.(); } catch { }
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
          pid: childPid,
          timeout_ms: timeoutMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          exit_code: code,
          stdout_tail: truncateForTemporalTrace(stdoutTail),
          stderr_tail: truncateForTemporalTrace(stderrTail),
        });
        cleanupCancellation();
        try { killHandle?.cancel?.(); } catch { }
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

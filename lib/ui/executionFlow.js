function createExecutionFlowLogger({ shouldLog, skipSteps } = {}) {
  const should = typeof shouldLog === 'function' ? shouldLog : () => true;
  const skip = Array.isArray(skipSteps) ? new Set(skipSteps) : new Set();

  return function logExecutionFlow(step, phase, detail = '') {
    // Historically gated by retryFlowActive; keep the hook.
    if (!should()) return;
    if (skip.has(step)) return;
    const info = detail ? ` | ${detail}` : '';
    console.log(`[worker] ${step} | ${phase}${info}`);
  };
}

module.exports = { createExecutionFlowLogger };


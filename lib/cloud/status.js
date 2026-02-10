function normalizeDecision(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizeStage(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * Decide whether to patch the cloud task into a terminal status after a stage completion.
 *
 * Context: some board runtimes advance `stage` to "done" but leave `status` as "in_progress".
 * This helper provides a best-effort fix from the CLI/daemon side.
 *
 * @param {object} params
 * @param {string} [params.decision] - daemon decision: done|blocked|failed|not_done
 * @param {string} [params.newStage] - board stage after /api/queue/complete
 * @param {string} [params.nowIso] - override for deterministic tests
 * @returns {object|null} patch body for PATCH /api/tasks/:id
 */
function buildCloudTaskTerminalPatch({ decision, newStage, nowIso } = {}) {
  const stage = normalizeStage(newStage);
  const d = normalizeDecision(decision);
  const now = nowIso || new Date().toISOString();

  // If the board says the task is in the "done" stage, treat it as completed regardless
  // of how the decision payload was normalized upstream.
  if (stage === 'done') {
    return { status: 'completed', completed_at: now };
  }

  // NOTE: decision "done" means the CURRENT STAGE is complete, not the entire task.
  // Only mark task as completed when stage reaches "done" (handled above).
  // Do NOT mark completed just because decision is "done" - that prematurely
  // ends tasks stuck in ideation/planning/execution.
  if (d === 'failed') return { status: 'failed', completed_at: now };
  if (d === 'blocked') return { status: 'blocked' };

  // For "done" and "not_done" decisions, let the stage machine handle transitions.
  // The task status will be updated by the orchestrator based on stage progression.
  return null;
}

module.exports = { buildCloudTaskTerminalPatch };


'use strict';

const LEGACY_STAGE_KEYS = new Set([
  'intake',
  'planning',
  'plan',
  'execute',
  'execution',
  'verify',
  'verification',
  'resume',
]);

const V2_STAGE_KEYS = new Set(['intake', 'progress']);
const V2_MODES = new Set(['simple', 'project']);

function normalizeStage(stage) {
  return String(stage || '').trim().toLowerCase();
}

function normalizeMode(mode) {
  return String(mode || '').trim().toLowerCase();
}

function hasGraphId(task) {
  const graphId = task?.graph_id || task?.graphId;
  return typeof graphId === 'string' && graphId.trim().length > 0;
}

function hasGraphPayload(task) {
  if (task?.execution_graph && typeof task.execution_graph === 'object') return true;
  if (task?.executionGraph && typeof task.executionGraph === 'object') return true;
  if (task?.graph && typeof task.graph === 'object') return true;
  return false;
}

function classifyTaskExecutionTrack(task) {
  const stageKey = normalizeStage(task?.stage);
  const modeKey = normalizeMode(task?.mode || task?.graph_mode || task?.graphMode);

  if (hasGraphId(task)) {
    return { track: 'v2', reason: 'graph_id_present', stageKey, modeKey };
  }

  if (hasGraphPayload(task)) {
    return { track: 'v2', reason: 'graph_payload_present', stageKey, modeKey };
  }

  if (V2_MODES.has(modeKey)) {
    return { track: 'v2', reason: `graph_mode_${modeKey}`, stageKey, modeKey };
  }

  if (V2_STAGE_KEYS.has(stageKey)) {
    return { track: 'v2', reason: `stage_${stageKey}`, stageKey, modeKey };
  }

  if (LEGACY_STAGE_KEYS.has(stageKey) || !stageKey) {
    return { track: 'legacy', reason: stageKey ? `stage_${stageKey}` : 'stage_unknown', stageKey, modeKey };
  }

  // Unknown stage keys are treated as legacy for backward compatibility.
  return { track: 'legacy', reason: `stage_${stageKey}`, stageKey, modeKey };
}

function buildV2RoutingError(task, trackInfo) {
  const taskId = String(task?.id || '').trim() || 'unknown-task';
  const stage = String(task?.stage || '').trim() || 'unknown';
  const mode = String(task?.mode || task?.graph_mode || task?.graphMode || '').trim() || 'unknown';
  const graphId = String(task?.graph_id || task?.graphId || '').trim() || 'none';
  const reason = trackInfo?.reason || 'v2_task_detected';

  return (
    `[v2-required] Task ${taskId} must run via the v2 execution graph runtime `
    + `(reason=${reason}, stage=${stage}, mode=${mode}, graph_id=${graphId}). `
    + 'Legacy execute/verify execution is disabled for v2 tasks.'
  );
}

module.exports = {
  classifyTaskExecutionTrack,
  buildV2RoutingError,
};

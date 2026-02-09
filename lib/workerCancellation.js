"use strict";

const CANCEL_STATUS_VALUES = new Set([
  "cancel",
  "cancelled",
  "canceled",
  "stopped",
  "terminated",
  "terminated_by_user",
  "timedout",
  "timed_out",
]);

const STATUS_KEYS = [
  "status",
  "workflowStatus",
  "workflow_status",
  "state",
  "task_state",
  "result",
  "workflow",
];

const CANCELLED_ERROR_CODE = "ECANCELLED";
const DEFAULT_CANCELLATION_CHECK_MS = 3000;

class CancellationRequestedError extends Error {
  constructor(reason) {
    super(reason || "Cancelled by operator");
    this.name = "CancellationRequestedError";
  }
}

function normalizeStatus(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

function collectStatusValues(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const statuses = [];

  for (const key of STATUS_KEYS) {
    const value = payload[key];
    if (typeof value === 'string') {
      statuses.push(value);
    } else if (value && typeof value === 'object') {
      if (typeof value.status === 'string') {
        statuses.push(value.status);
      }
      if (typeof value.workflowStatus === 'string') {
        statuses.push(value.workflowStatus);
      }
    }
  }

  return statuses
    .map(normalizeStatus)
    .filter(Boolean);
}

function hasCancellationFlag(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.cancelled === true) return true;
  if (payload.canceled === true) return true;
  if (payload.is_cancelled === true) return true;
  if (payload.cancel === true) return true;
  if (payload.stop === true) return true;
  if (payload.canceled_at || payload.cancelled_at || payload.cancel_at || payload.canceledAt || payload.cancelledAt) {
    return true;
  }
  if (payload?.signal === 'stop' || payload?.signal === 'cancel') return true;
  if (typeof payload?.lastSignal === 'string' && ['stop', 'cancel'].includes(payload.lastSignal.toLowerCase())) {
    return true;
  }
  return false;
}

function isCancellationPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (hasCancellationFlag(payload)) return true;

  const statuses = collectStatusValues(payload);
  for (const status of statuses) {
    if (CANCEL_STATUS_VALUES.has(status)) {
      return true;
    }
  }

  return false;
}

function extractCancellationReason(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.reason,
    payload.message,
    payload.description,
    payload.summary,
    payload.explanation,
    payload.cancel_reason,
    payload.cancelReason,
    payload.cancellation_reason,
    payload.cancellationMessage,
    payload.details?.reason,
    payload.signal_reason,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function createCancellationWatcher({ orchestrator, taskId, pollMs = DEFAULT_CANCELLATION_CHECK_MS }) {
  if (!taskId) {
    throw new Error('Task id is required for cancellation watcher');
  }
  if (!orchestrator || typeof orchestrator.queryTask !== 'function') {
    throw new Error('Orchestrator client with queryTask is required for cancellation watcher');
  }

  const intervalMs = Number.isFinite(pollMs) && pollMs > 0 ? Math.max(200, Math.floor(pollMs)) : DEFAULT_CANCELLATION_CHECK_MS;
  let cancelledPayload = null;
  let timer = null;
  let running = false;
  const listeners = new Set();

  const emit = () => {
    if (!cancelledPayload) return;
    for (const cb of Array.from(listeners)) {
      try {
        cb(cancelledPayload);
      } catch { }
    }
  };

  const poll = async () => {
    if (cancelledPayload) return cancelledPayload;
    try {
      const status = await orchestrator.queryTask(taskId);
      if (isCancellationPayload(status)) {
        cancelledPayload = status;
        emit();
        stop();
      }
    } catch {
      // Swallow errors to keep watcher resilient.
    }
    return cancelledPayload;
  };

  const scheduleNext = () => {
    if (!running || cancelledPayload) return;
    timer = setTimeout(async () => {
      timer = null;
      await poll();
      scheduleNext();
    }, intervalMs);
  };

  const start = () => {
    if (running) return;
    running = true;
    void poll().then(() => {
      if (running && !cancelledPayload) {
        scheduleNext();
      }
    });
  };

  const stop = () => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const destroy = () => {
    stop();
    listeners.clear();
  };

  const onCancel = (callback) => {
    if (typeof callback !== 'function') return () => { };
    listeners.add(callback);
    if (cancelledPayload) {
      callback(cancelledPayload);
    } else {
      start();
    }
    return () => listeners.delete(callback);
  };

  const isCancelled = () => Boolean(cancelledPayload);
  const getPayload = () => cancelledPayload;
  const getReason = () => extractCancellationReason(cancelledPayload);

  return {
    start,
    stop,
    destroy,
    check: poll,
    onCancel,
    isCancelled,
    getPayload,
    getReason,
  };
}

module.exports = {
  CANCELLED_ERROR_CODE,
  DEFAULT_CANCELLATION_CHECK_MS,
  CancellationRequestedError,
  createCancellationWatcher,
  isCancellationPayload,
  extractCancellationReason,
};

'use strict';

function buildHeaders(config) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.token}`,
    'x-user-id': config.userId || '',
  };
}

function normalizeError(data, status) {
  return data?.error || data?.message || `HTTP ${status}`;
}

function normalizeTaskId(input) {
  if (typeof input === 'string' && input.trim()) {
    return input.trim();
  }

  if (input && typeof input === 'object') {
    if (typeof input.taskId === 'string' && input.taskId.trim()) {
      return input.taskId.trim();
    }
    if (typeof input.id === 'string' && input.id.trim()) {
      return input.id.trim();
    }
  }

  throw new Error(`Invalid task id: ${String(input)}`);
}

async function apiRequest(config, method, endpoint, body = null) {
  if (!config?.apiUrl || !config?.token) {
    throw new Error('Not logged in to cloud. Run: agx login');
  }

  const response = await fetch(`${config.apiUrl}${endpoint}`, {
    method,
    headers: buildHeaders(config),
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(normalizeError(data, response.status));
  }

  return data;
}

function createTemporalClient(config) {
  const orchestratorBase = process.env.AGX_TEMPORAL_API_PREFIX || '/api/orchestrator/temporal';

  return {
    async startTask(taskId, options = {}) {
      const normalizedTaskId = normalizeTaskId(taskId);
      return apiRequest(config, 'POST', `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/start`, options);
    },

    async signalTask(taskId, signal, payload = {}) {
      const normalizedTaskId = normalizeTaskId(taskId);
      return apiRequest(config, 'POST', `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/signal`, {
        signal,
        payload,
      });
    },

    async queryTask(taskId, query = 'getStatus', args = null) {
      const normalizedTaskId = normalizeTaskId(taskId);
      return apiRequest(config, 'POST', `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/query`, {
        query,
        ...(args ? { args } : {})
      });
    },

    async cancelTask(taskId, reason = null) {
      const normalizedTaskId = normalizeTaskId(taskId);
      return apiRequest(config, 'POST', `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/cancel`, {
        ...(reason ? { reason } : {})
      });
    }
  };
}

module.exports = {
  createTemporalClient,
};

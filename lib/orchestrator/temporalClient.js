'use strict';

function buildHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': config.userId || '',
  };
  if (config?.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  return headers;
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

function isLocalApiUrl(apiUrl) {
  if (!apiUrl || typeof apiUrl !== 'string') return false;
  try {
    const u = new URL(apiUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '::1';
  } catch {
    return false;
  }
}

function isAuthDisabled(config) {
  if (!config || typeof config !== 'object') return false;
  if (config.authDisabled === true) return true;
  if (process.env.AGX_CLOUD_AUTH_DISABLED === '1') return true;
  if (process.env.AGX_BOARD_DISABLE_AUTH === '1') return true;
  return isLocalApiUrl(config.apiUrl);
}

async function apiRequest(config, method, endpoint, body = null) {
  if (!config?.apiUrl) {
    throw new Error('Cloud API URL not configured. Set AGX_CLOUD_URL (or run: agx login)');
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

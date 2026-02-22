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
    throw new Error('Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:3000)');
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

/**
 * Create an orchestrator HTTP client.
 */
function createHttpClient(config) {
  // Default path, supports legacy path via env var
  const orchestratorBase = process.env.AGX_ORCHESTRATOR_API_PREFIX || '/api/orchestrator';

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
      const endpoint = `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/status`;
      // New API expects GET /status for simple status reads; keep POST for advanced queries.
      if (query === 'getStatus' && !args) {
        return apiRequest(config, 'GET', endpoint);
      }
      return apiRequest(config, 'POST', endpoint, {
        query,
        ...(args ? { args } : {})
      });
    },

    async cancelTask(taskId, reason = null) {
      const normalizedTaskId = normalizeTaskId(taskId);
      return apiRequest(config, 'POST', `${orchestratorBase}/tasks/${encodeURIComponent(normalizedTaskId)}/cancel`, {
        ...(reason ? { reason } : {})
      });
    },

    /**
     * Write a memory record. Idempotent — duplicate (task_id, memory_type, content) returns 200.
     * @param {object} memory - { agent_id, task_id, memory_type, content }
     * @returns {{ ok: boolean, inserted: boolean }}
     */
    async postMemory({ agent_id, task_id, memory_type, content }) {
      return apiRequest(config, 'POST', '/api/memories', { agent_id, task_id, memory_type, content });
    },

    /**
     * Fetch memories by task_id or agent_id.
     * @param {{ task_id?: string, agent_id?: string }} params
     * @returns {Array}
     */
    async fetchMemories({ task_id, agent_id } = {}) {
      if (!task_id && !agent_id) {
        throw new Error('fetchMemories requires task_id or agent_id');
      }
      const qs = task_id ? `task_id=${encodeURIComponent(task_id)}` : `agent_id=${encodeURIComponent(agent_id)}`;
      return apiRequest(config, 'GET', `/api/memories?${qs}`);
    },
  };
}

module.exports = {
  createHttpClient,
};

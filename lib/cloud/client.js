const { loadCloudConfigFile, saveCloudConfigFile } = require('../config/cloudConfig');

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
  if (process.env.AGX_CLOUD_AUTH_DISABLED === '1') return true;
  if (process.env.AGX_BOARD_DISABLE_AUTH === '1') return true;
  if (config?.authDisabled === true) return true;
  return isLocalApiUrl(config?.apiUrl);
}

function createCloudClient({
  configDir,
  defaultApiUrl = 'http://localhost:41741',
} = {}) {
  function loadConfig() {
    return loadCloudConfigFile();
  }

  function saveConfig(config) {
    saveCloudConfigFile(config);
  }

  async function tryRefreshToken(config) {
    if (!config?.apiUrl || !config?.refreshToken) return null;

    try {
      const response = await fetch(`${config.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: config.refreshToken }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch { }

      if (!response.ok || !data?.access_token) {
        return null;
      }

      const updated = {
        ...config,
        token: data.access_token,
        refreshToken: data.refresh_token || config.refreshToken,
      };
      saveConfig(updated);
      return updated;
    } catch {
      return null;
    }
  }

  async function request(method, endpoint, body = null) {
    const config = loadConfig();
    if (!config?.apiUrl) {
      throw new Error('Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:41741)');
    }

    const url = `${config.apiUrl}${endpoint}`;

    const makeRequest = async (cfg) => {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': cfg.userId || '',
        },
      };
      if (cfg?.token) {
        fetchOptions.headers.Authorization = `Bearer ${cfg.token}`;
      }
      if (body) fetchOptions.body = JSON.stringify(body);

      const response = await fetch(url, fetchOptions);
      let data = null;
      try {
        data = await response.json();
      } catch { }
      return { response, data };
    };

    let activeConfig = config;
    let { response, data } = await makeRequest(activeConfig);

    if (response.status === 401) {
      const refreshedConfig = await tryRefreshToken(activeConfig);
      if (refreshedConfig?.token) {
        activeConfig = refreshedConfig;
        ({ response, data } = await makeRequest(activeConfig));
      }
    }

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data;
  }

  return {
    isLocalApiUrl,
    isAuthDisabled,
    loadConfig,
    saveConfig,
    tryRefreshToken,
    request,
    configDir,
  };
}

module.exports = { createCloudClient, isLocalApiUrl, isAuthDisabled };

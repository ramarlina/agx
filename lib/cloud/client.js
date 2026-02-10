const fs = require('fs');
const path = require('path');

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
  cloudConfigFile,
  defaultApiUrl = 'http://localhost:41741',
} = {}) {
  if (!configDir) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    configDir = path.join(home, '.agx');
  }
  if (!cloudConfigFile) {
    cloudConfigFile = path.join(configDir, 'cloud.json');
  }

  function loadConfig() {
    try {
      if (fs.existsSync(cloudConfigFile)) {
        const config = JSON.parse(fs.readFileSync(cloudConfigFile, 'utf8'));
        // Normalize: accept cloudUrl as fallback for apiUrl
        if (!config.apiUrl && config.cloudUrl) {
          config.apiUrl = config.cloudUrl;
        }
        return config;
      }
    } catch { }

    // Default to local board runtime when no config exists.
    const apiUrl = (process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || defaultApiUrl).replace(/\/$/, '');
    return {
      apiUrl,
      token: null,
      refreshToken: null,
      userId: process.env.AGX_USER_ID || '',
      authDisabled: isLocalApiUrl(apiUrl),
    };
  }

  function saveConfig(config) {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(cloudConfigFile, JSON.stringify(config, null, 2));
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
    cloudConfigFile,
  };
}

module.exports = { createCloudClient, isLocalApiUrl, isAuthDisabled };


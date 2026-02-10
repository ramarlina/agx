const fs = require('fs');
const { CONFIG_DIR, CONFIG_FILE, CLOUD_CONFIG_FILE } = require('./paths');

const DEFAULT_API_URL = 'http://localhost:41741';

function isLocalApiUrl(apiUrl) {
  if (!apiUrl || typeof apiUrl !== 'string') return false;
  try {
    const u = new URL(apiUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Migrate cloud.json into config.json's "cloud" key (one-time).
 * After migration the old file is left on disk but ignored.
 */
function migrateCloudJson() {
  try {
    if (!fs.existsSync(CLOUD_CONFIG_FILE)) return;
    const legacy = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
    if (!legacy || typeof legacy !== 'object') return;

    // Normalize cloudUrl → apiUrl
    if (!legacy.apiUrl && legacy.cloudUrl) {
      legacy.apiUrl = legacy.cloudUrl;
    }

    // Read existing config.json
    let config = {};
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
      }
    } catch { }

    // Only migrate if config.json doesn't already have a cloud section
    if (config.cloud) return;

    config.cloud = {
      apiUrl: legacy.apiUrl || DEFAULT_API_URL,
      token: legacy.token || null,
      refreshToken: legacy.refreshToken || null,
      userId: legacy.userId || '',
      authDisabled: legacy.authDisabled != null ? legacy.authDisabled : isLocalApiUrl(legacy.apiUrl || DEFAULT_API_URL),
    };

    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch { }
}

/**
 * Load cloud config from config.json's "cloud" key.
 * Falls back to env vars and defaults.
 * On first call, migrates legacy cloud.json if present.
 */
function loadCloudConfigFile() {
  // One-time migration from cloud.json
  migrateCloudJson();

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (config && config.cloud) {
        const cloud = config.cloud;
        // Normalize cloudUrl → apiUrl
        if (!cloud.apiUrl && cloud.cloudUrl) {
          cloud.apiUrl = cloud.cloudUrl;
        }
        return cloud;
      }
    }
  } catch { }

  // Fallback: env vars → default
  const apiUrl = (process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || DEFAULT_API_URL).replace(/\/$/, '');
  return {
    apiUrl,
    token: null,
    refreshToken: null,
    userId: process.env.AGX_USER_ID || '',
    authDisabled: isLocalApiUrl(apiUrl),
  };
}

/**
 * Save cloud config into config.json's "cloud" key.
 */
function saveCloudConfigFile(cloudData) {
  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    }
  } catch { }

  config.cloud = cloudData;

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Clear cloud credentials from config.json (used by logout).
 */
function clearCloudConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    delete config.cloud;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch { }
}

module.exports = { loadCloudConfigFile, saveCloudConfigFile, clearCloudConfig, DEFAULT_API_URL };

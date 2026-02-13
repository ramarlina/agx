'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const POSTHOG_KEY = 'phc_oBf1haYu4HKjYmUZpthQ4cUf9O3UKkDSOX675M7dRWW';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let client = null;
let distinctId = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch { }
  return null;
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function isEnabled() {
  if (process.env.AGX_TELEMETRY === '0') return false;
  const config = loadConfig();
  if (config?.telemetry?.enabled === false) return false;
  return true;
}

function getAnonymousId() {
  if (distinctId) return distinctId;
  const config = loadConfig() || {};
  if (config.telemetry?.anonymousId) {
    distinctId = config.telemetry.anonymousId;
    return distinctId;
  }
  distinctId = crypto.randomUUID();
  config.telemetry = { ...config.telemetry, anonymousId: distinctId };
  saveConfig(config);
  return distinctId;
}

function getClient() {
  if (client) return client;
  if (!isEnabled()) return null;
  try {
    const { PostHog } = require('posthog-node');
    client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
    return client;
  } catch {
    return null;
  }
}

function track(event, properties = {}) {
  const ph = getClient();
  if (!ph) return;
  try {
    const version = (() => { try { return require('../package.json').version; } catch { return 'unknown'; } })();
    ph.capture({
      distinctId: getAnonymousId(),
      event,
      properties: {
        os: os.platform(),
        arch: os.arch(),
        node_version: process.version,
        agx_version: version,
        ...properties,
      },
    });
  } catch { }
}

async function shutdown() {
  if (client) {
    try { await client.shutdown(); } catch { }
    client = null;
  }
}

function setEnabled(enabled) {
  const config = loadConfig() || {};
  config.telemetry = { ...config.telemetry, enabled };
  saveConfig(config);
}

function getStatus() {
  return isEnabled() ? 'enabled' : 'disabled';
}

function showNoticeIfFirstRun() {
  const config = loadConfig() || {};
  if (config.telemetry?.noticeSeen) return;
  console.log('\n  \x1b[2magx collects anonymous usage data to improve the tool.\x1b[0m');
  console.log('  \x1b[2mRun \x1b[0magx telemetry off\x1b[2m to disable.\x1b[0m\n');
  config.telemetry = { ...config.telemetry, noticeSeen: true };
  saveConfig(config);
}

module.exports = { track, shutdown, isEnabled, setEnabled, getStatus, showNoticeIfFirstRun };

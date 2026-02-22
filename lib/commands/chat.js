'use strict';

const { execSync } = require('child_process');
const { loadCloudConfigFile } = require('../config/cloudConfig');

async function maybeHandleChatCommand({ cmd }) {
  if (cmd !== 'chat') return false;

  const config = loadCloudConfigFile() || {};
  const url = config.url || process.env.AGX_CLOUD_URL || 'http://localhost:41741';

  execSync(`open "${url}"`, { stdio: 'inherit' });
  return true;
}

module.exports = { maybeHandleChatCommand };

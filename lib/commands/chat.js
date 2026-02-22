'use strict';

const { loadCloudConfigFile } = require('../config/cloudConfig');

async function maybeHandleChatCommand({ cmd, ctx }) {
  if (cmd !== 'chat') return false;

  const { ensureBoardRunning, probeBoardHealth, getBoardPort, setBoardEnsuredFalse } = ctx || {};

  // Ensure the backend is running before opening the browser
  if (typeof setBoardEnsuredFalse === 'function') setBoardEnsuredFalse();
  if (typeof ensureBoardRunning === 'function') await ensureBoardRunning();

  const config = loadCloudConfigFile() || {};
  const url = config.url || process.env.AGX_CLOUD_URL || 'http://localhost:41741';

  // Wait for the board to be healthy before opening
  if (typeof probeBoardHealth === 'function' && typeof getBoardPort === 'function') {
    await probeBoardHealth(getBoardPort());
  }

  const { openInBrowser } = require('./daemonBoard');
  openInBrowser(url);
  return true;
}

module.exports = { maybeHandleChatCommand };

'use strict';

const { loadCloudConfigFile } = require('../config/cloudConfig');

async function maybeHandleChatCommand({ cmd, args, ctx }) {
  if (cmd !== 'chat') return false;

  const subcommand = (args[0] || '').toLowerCase();

  if (subcommand === 'stop') {
    const { stopBoard, isBoardRunning } = require('../cli/daemon');
    if (!isBoardRunning()) {
      console.log('Chat server is not running.');
      return true;
    }
    console.log('Stopping chat server...');
    const stopped = await stopBoard();
    console.log(stopped ? 'Chat server stopped.' : 'Failed to stop chat server.');
    return true;
  }

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

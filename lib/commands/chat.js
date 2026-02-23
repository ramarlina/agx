'use strict';

const { loadCloudConfigFile } = require('../config/cloudConfig');

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg === '--open') flags.open = true;
  }
  return flags;
}

async function maybeHandleChatCommand({ cmd, args, ctx }) {
  if (cmd !== 'chat') return false;

  const subcommand = (args[0] || '').toLowerCase();
  const flags = parseFlags(args);

  const { ensureBoardRunning, probeBoardHealth, getBoardPort, setBoardEnsuredFalse } = ctx || {};

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

  // Start server for: agx chat, agx chat start, agx chat open, agx chat start --open
  if (typeof setBoardEnsuredFalse === 'function') setBoardEnsuredFalse();
  if (typeof ensureBoardRunning === 'function') await ensureBoardRunning();

  const config = loadCloudConfigFile() || {};
  const url = config.url || process.env.AGX_CLOUD_URL || 'http://localhost:41741';

  if (typeof probeBoardHealth === 'function' && typeof getBoardPort === 'function') {
    await probeBoardHealth(getBoardPort());
  }

  // Open browser for: agx chat, agx chat open, agx chat start --open
  // Do NOT open for: agx chat start (without --open)
  const shouldOpen = subcommand !== 'start' || flags.open;
  if (shouldOpen) {
    const { openInBrowser } = require('./daemonBoard');
    openInBrowser(url);
  }

  return true;
}

module.exports = { maybeHandleChatCommand };

'use strict';

const { loadCloudConfigFile, saveCloudConfigFile } = require('../config/cloudConfig');
const crypto = require('crypto');

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg === '--open') flags.open = true;
  }
  return flags;
}

/**
 * Parse args for `agx chat send "message" --thread <id> [--role user|agent] [--agent <slug>] [--max-rounds N]`
 */
function parseSendArgs(args) {
  const opts = { message: null, thread: null, role: 'user', agent: null, maxRounds: 10 };
  let i = 2; // skip 'chat' 'send'
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--thread' && args[i + 1]) { opts.thread = args[++i]; }
    else if (arg === '--role' && args[i + 1]) { opts.role = args[++i].toLowerCase(); }
    else if (arg === '--agent' && args[i + 1]) { opts.agent = args[++i]; }
    else if (arg === '--max-rounds' && args[i + 1]) { opts.maxRounds = parseInt(args[++i], 10) || 10; }
    else if (!arg.startsWith('--') && !opts.message) { opts.message = arg; }
    i++;
  }
  return opts;
}

async function handleChatSend(args) {
  const opts = parseSendArgs(args);

  if (!opts.message) {
    console.error('Usage: agx chat send "message" --thread <rootMessageId> [--role user|agent] [--agent <slug>] [--max-rounds N]');
    process.exit(1);
  }
  if (!opts.thread) {
    console.error('Error: --thread <rootMessageId> is required');
    process.exit(1);
  }
  if (opts.role !== 'user' && opts.role !== 'agent') {
    console.error('Error: --role must be "user" or "agent"');
    process.exit(1);
  }
  if (opts.role === 'user' && opts.agent) {
    console.error('Error: --agent cannot be used with --role user');
    process.exit(1);
  }

  const config = loadCloudConfigFile() || {};
  const apiUrl = config.apiUrl || config.url || process.env.AGX_BOARD_URL || process.env.AGX_CLOUD_URL || 'http://localhost:41741';

  const headers = { 'Content-Type': 'application/json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
  if (config.userId) headers['x-user-id'] = config.userId;

  // Resolve workspace threadId from the root message ID
  let workspaceThreadId;
  try {
    const metaRes = await fetch(`${apiUrl}/api/messages/${opts.thread}`, { headers });
    if (!metaRes.ok) {
      console.error(`Error: Could not resolve thread for root message ${opts.thread} (${metaRes.status})`);
      process.exit(1);
    }
    const meta = await metaRes.json();
    workspaceThreadId = meta.threadId;
    if (!workspaceThreadId) {
      console.error(`Error: No threadId found for root message ${opts.thread}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: Could not connect to ${apiUrl} — is the chat server running?`);
    process.exit(1);
  }

  const userMessageId = crypto.randomUUID();
  const body = {
    threadId: workspaceThreadId,
    prompt: opts.message,
    maxRounds: opts.maxRounds,
    userMessageId,
    rootMessageId: opts.thread,
    role: opts.role || 'user',
    agent: opts.agent || undefined,
  };

  // If role=agent with a specific agent, set activeParticipantIds
  if (opts.role === 'agent' && opts.agent) {
    body.activeParticipantIds = [opts.agent];
  }

  let response;
  try {
    response = await fetch(`${apiUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Error: Could not connect to ${apiUrl} — is the chat server running?`);
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`Error: ${response.status} ${response.statusText}${text ? ' — ' + text : ''}`);
    process.exit(1);
  }

  // Stream SSE response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'participant-end' && event.content) {
          const label = event.participantId || 'Agent';
          console.log(`[${label}] ${event.content}`);
        } else if (event.type === 'participant-error') {
          console.error(`[error] ${event.error || event.content || 'Unknown error'}`);
        }
      } catch { /* skip non-JSON lines */ }
    }
  }

  return true;
}

async function maybeHandleChatCommand({ cmd, args, ctx }) {
  if (cmd !== 'chat') return false;

  const subcommand = (args[1] || '').toLowerCase();
  const flags = parseFlags(args);

  // Handle `agx chat send ...` before starting the server
  if (subcommand === 'send') {
    return handleChatSend(args);
  }

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

  // Also start daemon with 1 worker so tasks can execute
  const { startDaemon } = require('../cli/daemon');
  startDaemon({ maxWorkers: 1 });

  const config = loadCloudConfigFile() || {};
  const url = config.url || process.env.AGX_BOARD_URL || process.env.AGX_CLOUD_URL || 'http://localhost:41741';

  if (typeof probeBoardHealth === 'function' && typeof getBoardPort === 'function') {
    await probeBoardHealth(getBoardPort());
  }

  // Open browser for: agx chat, agx chat open, agx chat start --open
  // Do NOT open for: agx chat start (without --open)
  const shouldOpen = subcommand !== 'start' || flags.open;
  if (shouldOpen) {
    const { openInBrowser } = require('./daemonBoard');
    openInBrowser(url);
    if (!config.hasSeenWelcome) {
      saveCloudConfigFile({ ...config, hasSeenWelcome: true });
    }
  }

  return true;
}

module.exports = { maybeHandleChatCommand };

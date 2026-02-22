'use strict';

const { c } = require('../ui/colors');
const { loadConfig } = require('../cli/configStore');
const { detectProviders } = require('../cli/providers');
const { startChat } = require('../cli/chat');

const PROVIDER_ALIASES = {
  'c': 'claude', 'cl': 'claude', 'claude': 'claude',
  'x': 'codex', 'codex': 'codex',
  'g': 'gemini', 'gem': 'gemini', 'gemini': 'gemini',
  'o': 'ollama', 'ol': 'ollama', 'ollama': 'ollama'
};

async function maybeHandleChatCommand({ cmd, args }) {
  if (cmd !== 'chat') return false;

  const config = loadConfig() || {};
  const providers = detectProviders();

  // agx chat [provider]
  let providerArg = args[1];
  let provider = null;
  let model = null;
  let taskId = null;

  // Simple arg parsing
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' || arg === '-m') {
      model = args[++i];
      continue;
    }
    if (arg === '--task' || arg === '-t') {
      taskId = args[++i];
      continue;
    }
    if (arg === '--resume' || arg === '-r') {
      // Resume last chat? Not implemented yet, but we can support --task
      continue;
    }
    if (!arg.startsWith('-')) {
      if (!provider) {
        const alias = PROVIDER_ALIASES[arg.toLowerCase()];
        if (alias) {
          provider = alias;
        } else {
           // Maybe it's a model or something else?
           // For now, assume unknown arg is provider if it looks like one
           if (['claude', 'gemini', 'ollama', 'codex'].includes(arg)) {
             provider = arg;
           }
        }
      }
    }
  }

  if (!provider) {
    // Check config or pick one
    provider = config.defaultProvider;
    if (!provider) {
      if (providers.claude) provider = 'claude';
      else if (providers.gemini) provider = 'gemini';
      else if (providers.codex) provider = 'codex';
      else if (providers.ollama) provider = 'ollama';
    }
  }

  if (!provider) {
    console.log(`${c.yellow}No AI provider found or configured.${c.reset}`);
    console.log(`Run ${c.cyan}agx init${c.reset} or install a provider.`);
    return true;
  }

  // If the provider CLI is missing, startChat might fail or we should warn.
  // startChat handles detection too, but let's be safe.
  if (!providers[provider] && provider !== 'codex') { // codex might be via npx?
      // warning handled in startChat
  }

  try {
    await startChat({
      provider,
      model,
      taskId,
      configDir: config.configDir // Optional
    });
  } catch (err) {
    console.log(`${c.red}Chat session failed:${c.reset} ${err.message}`);
  }

  return true;
}

module.exports = { maybeHandleChatCommand };

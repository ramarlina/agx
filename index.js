#!/usr/bin/env node

const { spawn } = require('child_process');

const args = process.argv.slice(2);
let provider = args[0];

// Normalize provider aliases
const PROVIDER_ALIASES = {
  'g': 'gemini',
  'gem': 'gemini',
  'gemini': 'gemini',
  'c': 'claude',
  'cl': 'claude',
  'claude': 'claude',
  'o': 'ollama',
  'ol': 'ollama',
  'ollama': 'ollama'
};

const VALID_PROVIDERS = ['gemini', 'claude', 'ollama'];

// Handle help/version before provider check
if (args.includes('--help') || args.includes('-h') || !provider) {
  console.log(`agx - Unified AI Agent CLI

SYNTAX:
  agx <provider> [options] "<prompt>"
  agx <provider> [options] --prompt "<prompt>"

PROVIDERS:
  gemini, gem, g     Google Gemini
  claude, cl, c      Anthropic Claude
  ollama, ol, o      Local Ollama (via Claude interface)

OPTIONS:
  --prompt, -p <text>    The prompt to send (recommended for clarity)
  --model, -m <name>     Model name to use
  --yolo, -y             Skip permission prompts
  --print                Non-interactive mode (output and exit)
  --interactive, -i      Force interactive mode
  --sandbox, -s          Enable sandbox (gemini only)
  --debug, -d            Enable debug output
  --mcp <config>         MCP config file (claude/ollama only)

EXAMPLES:
  agx claude --prompt "explain this code"
  agx gemini -m gemini-2.0-flash --prompt "hello"
  agx ollama --model qwen3:8b --prompt "write a poem"
  agx c --yolo -p "fix the bug"

RAW PASSTHROUGH:
  Use -- to pass arguments directly to underlying CLI:
  agx claude -- --resume

NOTE: For predictable LLM usage, always use --prompt or -p flag.`);
  process.exit(0);
}

// Resolve provider
provider = PROVIDER_ALIASES[provider.toLowerCase()];
if (!provider) {
  console.error(`Error: Unknown provider "${args[0]}"`);
  console.error(`Valid providers: ${VALID_PROVIDERS.join(', ')}`);
  process.exit(1);
}

const remainingArgs = args.slice(1);
const translatedArgs = [];
const rawArgs = [];
let env = { ...process.env };

// Split raw arguments at --
const dashIndex = remainingArgs.indexOf('--');
let processedArgs = remainingArgs;
if (dashIndex !== -1) {
  processedArgs = remainingArgs.slice(0, dashIndex);
  rawArgs.push(...remainingArgs.slice(dashIndex + 1));
}

// Parsed options (explicit structure for predictability)
const options = {
  prompt: null,
  model: null,
  yolo: false,
  print: false,
  interactive: false,
  sandbox: false,
  debug: false,
  mcp: null
};

// Collect positional args (legacy support, but --prompt is preferred)
const positionalArgs = [];

for (let i = 0; i < processedArgs.length; i++) {
  const arg = processedArgs[i];
  const nextArg = processedArgs[i + 1];

  switch (arg) {
    case '--prompt':
    case '-p':
      if (nextArg && !nextArg.startsWith('-')) {
        options.prompt = nextArg;
        i++;
      }
      break;
    case '--model':
    case '-m':
      if (nextArg && !nextArg.startsWith('-')) {
        options.model = nextArg;
        i++;
      }
      break;
    case '--yolo':
    case '-y':
      options.yolo = true;
      break;
    case '--print':
      options.print = true;
      break;
    case '--interactive':
    case '-i':
      options.interactive = true;
      break;
    case '--sandbox':
    case '-s':
      options.sandbox = true;
      break;
    case '--debug':
    case '-d':
      options.debug = true;
      break;
    case '--mcp':
      if (nextArg && !nextArg.startsWith('-')) {
        options.mcp = nextArg;
        i++;
      }
      break;
    default:
      if (arg.startsWith('-')) {
        // Unknown flag - pass through
        translatedArgs.push(arg);
      } else {
        // Positional argument (legacy prompt support)
        positionalArgs.push(arg);
      }
  }
}

// Determine final prompt: explicit --prompt takes precedence
const finalPrompt = options.prompt || positionalArgs.join(' ') || null;

// Build command based on provider
let command = '';

// Apply common options to translatedArgs
if (options.model) {
  translatedArgs.push('--model', options.model);
}
if (options.debug) {
  translatedArgs.push('--debug');
}

if (provider === 'gemini') {
  command = 'gemini';

  // Gemini-specific translations
  if (options.yolo) translatedArgs.push('--yolo');
  if (options.sandbox) translatedArgs.push('--sandbox');

  // Gemini prompt handling
  if (finalPrompt) {
    if (options.print) {
      translatedArgs.push('--prompt', finalPrompt);
    } else if (options.interactive) {
      translatedArgs.push('--prompt-interactive', finalPrompt);
    } else {
      translatedArgs.push(finalPrompt);
    }
  }
} else {
  // Claude or Ollama
  command = 'claude';

  // Claude-specific translations
  if (options.yolo) translatedArgs.push('--dangerously-skip-permissions');
  if (options.print) translatedArgs.push('--print');
  if (options.mcp) translatedArgs.push('--mcp-config', options.mcp);

  // Ollama-specific environment setup
  if (provider === 'ollama') {
    env.ANTHROPIC_AUTH_TOKEN = 'ollama';
    env.ANTHROPIC_BASE_URL = 'http://localhost:11434';
    env.ANTHROPIC_API_KEY = 'none';
    // Default model for Ollama if not specified
    if (!options.model) {
      translatedArgs.push('--model', 'glm-4.7:cloud');
    }
  }

  // Claude prompt (positional at end)
  if (finalPrompt) {
    translatedArgs.push(finalPrompt);
  }
}

// Append raw args at the end
translatedArgs.push(...rawArgs);

const child = spawn(command, translatedArgs, {
  env,
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`Error: "${command}" command not found.`);
  } else {
    console.error(`Failed to start ${command}:`, err);
  }
  process.exit(1);
});

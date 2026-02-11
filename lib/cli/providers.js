/* eslint-disable no-console */
'use strict';

const path = require('path');
const execa = require('execa');

const { c } = require('../ui/colors');
const { commandExists } = require('../proc/commandExists');
const { prompt } = require('./configStore');

function detectProviders() {
  return {
    claude: commandExists('claude'),
    gemini: commandExists('gemini'),
    ollama: commandExists('ollama'),
    codex: commandExists('codex')
  };
}

function printProviderStatus(providers) {
  console.log(`\n${c.bold}Detected Providers:${c.reset}\n`);

  const status = (installed) => installed
    ? `${c.green}✓ installed${c.reset}`
    : `${c.dim}✗ not found${c.reset}`;

  console.log(`  ${c.cyan}claude${c.reset}  │ Anthropic Claude Code  │ ${status(providers.claude)}`);
  console.log(`  ${c.cyan}gemini${c.reset}  │ Google Gemini CLI      │ ${status(providers.gemini)}`);
  console.log(`  ${c.cyan}ollama${c.reset}  │ Local Ollama           │ ${status(providers.ollama)}`);
  console.log(`  ${c.cyan}codex${c.reset}   │ OpenAI Codex CLI       │ ${status(providers.codex)}`);
}

function runInteractive(cmd, args = [], options = {}) {
  return new Promise((resolve) => {
    // Support both: runInteractive('npm', ['i', ...]) and runInteractive('npm i ...')
    const useCommand = !Array.isArray(args) || args.length === 0;
    const child = useCommand
      ? execa.command(String(cmd), { stdio: 'inherit', shell: true, reject: false, ...options })
      : execa(cmd, args, { stdio: 'inherit', shell: false, reject: false, ...options });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function runSilent(cmd) {
  try {
    const res = execa.commandSync(cmd, { stdio: 'ignore', shell: true, reject: false });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

function isOllamaRunning() {
  try {
    const res = execa.sync('curl', ['-s', 'http://localhost:11434/api/tags'], {
      stdio: 'ignore',
      timeout: 2000,
      reject: false,
    });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

function getOllamaModels() {
  try {
    const result = execa.sync('ollama', ['list'], { encoding: 'utf8', stderr: 'ignore', reject: false });
    if (result.exitCode !== 0) return [];
    const lines = String(result.stdout || '').trim().split('\n').slice(1);
    return lines.map((l) => l.split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

const PROVIDERS = {
  claude: {
    name: 'Claude Code',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    description: 'Anthropic Claude AI assistant'
  },
  gemini: {
    name: 'Gemini CLI',
    installCmd: 'npm install -g @google/gemini-cli',
    description: 'Google Gemini AI assistant'
  },
  ollama: {
    name: 'Ollama',
    installCmd: process.platform === 'darwin'
      ? 'brew install ollama'
      : 'curl -fsSL https://ollama.ai/install.sh | sh',
    description: 'Local AI models'
  },
  codex: {
    name: 'Codex CLI',
    installCmd: 'npm install -g @openai/codex',
    description: 'OpenAI Codex CLI'
  }
};

async function installProvider(provider) {
  const info = PROVIDERS[provider];
  if (!info) return false;

  console.log(`\n${c.cyan}Installing ${info.name}...${c.reset}\n`);
  console.log(`${c.dim}$ ${info.installCmd}${c.reset}\n`);

  const success = await runInteractive(info.installCmd);

  if (success && commandExists(provider)) {
    console.log(`\n${c.green}✓${c.reset} ${info.name} installed successfully!`);
    return true;
  }

  console.log(`\n${c.red}✗${c.reset} Installation failed. Try manually:`);
  console.log(`  ${c.dim}${info.installCmd}${c.reset}`);
  return false;
}

async function loginProvider(provider) {
  console.log('');

  if (provider === 'claude') {
    console.log(`${c.cyan}Launching Claude Code for authentication...${c.reset}`);
    console.log(`${c.dim}This will open a browser to log in with your Anthropic account.${c.reset}\n`);
    await runInteractive('claude');
    return true;
  }

  if (provider === 'gemini') {
    console.log(`${c.cyan}Launching Gemini CLI for authentication...${c.reset}`);
    console.log(`${c.dim}This will open a browser to log in with your Google account.${c.reset}\n`);
    await runInteractive('gemini');
    return true;
  }

  if (provider === 'ollama') {
    if (!isOllamaRunning()) {
      console.log(`${c.yellow}Ollama server is not running.${c.reset}`);
      const startIt = await prompt('Start it now? [Y/n]: ');
      if (startIt.toLowerCase() !== 'n') {
        console.log(`\n${c.cyan}Starting Ollama server in background...${c.reset}`);
        const child = execa('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore',
          reject: false,
        });
        child.unref?.();
        await new Promise((r) => setTimeout(r, 2000));
        if (isOllamaRunning()) {
          console.log(`${c.green}✓${c.reset} Ollama server started!`);
        } else {
          console.log(`${c.yellow}Server may still be starting. Run ${c.reset}ollama serve${c.yellow} manually if needed.${c.reset}`);
        }
      }
    } else {
      console.log(`${c.green}✓${c.reset} Ollama server is running`);
    }

    const models = getOllamaModels();
    if (models.length === 0) {
      console.log(`\n${c.yellow}No models installed.${c.reset}`);
      console.log(`\n${c.bold}Popular models:${c.reset}`);
      console.log(`  ${c.cyan}1${c.reset}) glm-4.7:cloud ${c.dim}(?) - Recommended default${c.reset}`);
      console.log(`  ${c.cyan}2${c.reset}) qwen3:8b      ${c.dim}(4.9 GB) - Great all-rounder${c.reset}`);
      console.log(`  ${c.cyan}3${c.reset}) codellama:7b  ${c.dim}(3.8 GB) - Code specialist${c.reset}`);
      console.log(`  ${c.cyan}4${c.reset}) mistral:7b    ${c.dim}(4.1 GB) - Good general model${c.reset}`);
      console.log(`  ${c.cyan}5${c.reset}) Skip for now`);

      const choice = await prompt('\nWhich model to pull? [1]: ');
      const modelMap = {
        '1': 'glm-4.7:cloud',
        '2': 'qwen3:8b',
        '3': 'codellama:7b',
        '4': 'mistral:7b',
        '': 'glm-4.7:cloud'
      };
      const model = modelMap[choice];
      if (model) {
        console.log(`\n${c.cyan}Pulling ${model}...${c.reset}`);
        console.log(`${c.dim}This may take a few minutes depending on your connection.${c.reset}\n`);
        await runInteractive(`ollama pull ${model}`);
      }
    } else {
      console.log(`${c.green}✓${c.reset} Found ${models.length} model(s): ${c.dim}${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}${c.reset}`);
    }
    return true;
  }

  if (provider === 'codex') {
    console.log(`${c.cyan}Launching Codex CLI for authentication...${c.reset}`);
    await runInteractive('codex');
    return true;
  }

  return false;
}

async function runAgxModelSmokeTest({ provider, model }) {
  const entry = process.argv[1] || path.join(__dirname, '../../index.js');
  const cmd = process.execPath;
  const args = [entry, provider, '--model', model, '-y', '-p', 'say yes'];

  console.log(`\n${c.bold}Smoke test:${c.reset}`);
  console.log(`${c.dim}$ agx ${provider} --model ${model} -y -p "say yes"${c.reset}\n`);

  return await new Promise((resolve) => {
    const child = execa(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      reject: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const MAX_CAPTURE = 32_000;
    const append = (buf, chunk) => {
      const next = buf + chunk;
      return next.length > MAX_CAPTURE ? next.slice(-MAX_CAPTURE) : next;
    };

    child.stdout?.on('data', (d) => { stdout = append(stdout, String(d)); });
    child.stderr?.on('data', (d) => { stderr = append(stderr, String(d)); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { }
    }, 60_000);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, signal, stdout, stderr, timedOut });
    });
  });
}

module.exports = {
  PROVIDERS,
  detectProviders,
  printProviderStatus,
  runInteractive,
  runSilent,
  isOllamaRunning,
  getOllamaModels,
  installProvider,
  loginProvider,
  runAgxModelSmokeTest,
};

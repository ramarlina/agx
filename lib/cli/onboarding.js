/* eslint-disable no-console */
'use strict';

const { c } = require('../ui/colors');
const { loadConfig, saveConfig, prompt } = require('./configStore');
const { loadCloudConfigFile, saveCloudConfigFile, DEFAULT_API_URL } = require('../config/cloudConfig');
const {
  PROVIDERS,
  detectProviders,
  printProviderStatus,
  installProvider,
  loginProvider,
  getOllamaModels,
  runAgxModelSmokeTest,
} = require('./providers');

async function runOnboarding() {
  console.log(`
${c.bold}${c.cyan}╭─────────────────────────────────────────╮${c.reset}
${c.bold}${c.cyan}│${c.reset}   ${c.bold}Welcome to agx${c.reset}                       ${c.cyan}│${c.reset}
${c.bold}${c.cyan}│${c.reset}   ${c.dim}Unified AI Agent CLI${c.reset}                 ${c.cyan}│${c.reset}
${c.bold}${c.cyan}╰─────────────────────────────────────────╯${c.reset}
`);

  let providers = detectProviders();
  printProviderStatus(providers);

  const missing = Object.entries(providers)
    .filter(([_, installed]) => !installed)
    .map(([name]) => name);

  let available = Object.entries(providers)
    .filter(([_, installed]) => installed)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.log(`\n${c.bold}Would you like to install any providers?${c.reset}\n`);

    for (const provider of missing) {
      const info = PROVIDERS[provider];
      const answer = await prompt(`  Install ${c.cyan}${provider}${c.reset} (${info.description})? [y/N]: `);

      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        const success = await installProvider(provider);
        if (success) {
          providers[provider] = true;
          available.push(provider);
        }
      }
    }

    providers = detectProviders();
    available = Object.entries(providers)
      .filter(([_, installed]) => installed)
      .map(([name]) => name);
  }

  if (available.length === 0) {
    console.log(`\n${c.yellow}⚠${c.reset}  No AI providers installed.\n`);
    console.log(`${c.dim}Run ${c.reset}agx init${c.dim} again to install providers.${c.reset}\n`);
    process.exit(0);
  }

  console.log(`\n${c.green}✓${c.reset} Available providers: ${c.bold}${available.join(', ')}${c.reset}`);

  let defaultProvider = available[0];

  if (available.length > 1) {
    console.log(`\n${c.bold}Choose your default provider:${c.reset}`);
    available.forEach((p, i) => {
      console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}`);
    });

    const choice = await prompt(`\nEnter number [${c.dim}1${c.reset}]: `);
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < available.length) {
      defaultProvider = available[idx];
    }
  }

  let defaultModel = '';
  if (defaultProvider === 'ollama') {
    const models = getOllamaModels();
    console.log(`\n${c.bold}Choose your default model:${c.reset}`);
    while (!defaultModel) {
      if (models.length > 0) {
        models.slice(0, 10).forEach((m, i) => {
          console.log(`  ${c.cyan}${i + 1}${c.reset}) ${m}`);
        });
        const choice = await prompt(`\nEnter number [${c.dim}1${c.reset}] or type a model name: `);
        if (!choice) {
          defaultModel = models[0];
        } else if (/^\d+$/.test(choice)) {
          const idx = parseInt(choice, 10) - 1;
          defaultModel = (idx >= 0 && idx < models.length) ? models[idx] : '';
        } else {
          defaultModel = choice.trim();
        }
      } else {
        defaultModel = await prompt(`\nEnter an Ollama model name (e.g. llama3.2:3b): `);
      }
    }
  } else {
    while (!defaultModel) {
      defaultModel = await prompt(`\nEnter default model for ${c.cyan}${defaultProvider}${c.reset}: `);
    }
  }

  const models = { [defaultProvider]: defaultModel };
  const changedAt = new Date().toISOString();
  const config = {
    version: 1,
    defaultProvider,
    models,
    ...(defaultProvider === 'ollama' ? { ollama: { model: defaultModel } } : {}),
    settingsMeta: { provenance: 'cli', changedAt },
    initialized: true,
    providers: providers
  };

  saveConfig(config);

  console.log(`\n${c.green}✓${c.reset} Configuration saved to ${c.dim}~/.agx/config.json${c.reset}`);
  console.log(`${c.green}✓${c.reset} Default provider: ${c.bold}${c.cyan}${defaultProvider}${c.reset}`);
  console.log(`${c.green}✓${c.reset} Default model: ${c.bold}${c.cyan}${defaultModel}${c.reset}`);

  const smoke = await runAgxModelSmokeTest({ provider: defaultProvider, model: defaultModel });
  if (smoke.timedOut || smoke.code !== 0) {
    console.error(`\n${c.red}✗${c.reset} Smoke test failed for ${c.cyan}${defaultProvider}${c.reset} (${c.cyan}${defaultModel}${c.reset})`);
    if (smoke.timedOut) {
      console.error(`${c.red}Error:${c.reset} timed out after 60s`);
    } else {
      console.error(`${c.red}Exit code:${c.reset} ${smoke.code}${smoke.signal ? ` (signal ${smoke.signal})` : ''}`);
    }
    const combined = `${smoke.stderr || ''}${smoke.stdout ? (smoke.stderr ? '\n' : '') + smoke.stdout : ''}`.trim();
    if (combined) {
      console.error(`\n${c.dim}${combined}${c.reset}`);
    }
    console.error(`\n${c.dim}Fix:${c.reset} run ${c.cyan}agx add ${defaultProvider}${c.reset} then ${c.cyan}agx config${c.reset} (or re-run ${c.cyan}agx init${c.reset})`);
    process.exit(1);
  }
  console.log(`${c.green}✓${c.reset} Smoke test succeeded`);

  console.log(`
${c.bold}Quick Start:${c.reset}

  ${c.dim}# One-shot question${c.reset}
  ${c.cyan}agx -p "explain this code"${c.reset}

  ${c.dim}# Create and run a task${c.reset}
  ${c.cyan}agx new "build a REST API"${c.reset}
  ${c.cyan}agx run <task_id>${c.reset}

  ${c.dim}# Fully autonomous${c.reset}
  ${c.cyan}agx -a -p "refactor auth middleware"${c.reset}

${c.dim}Run ${c.reset}agx config${c.dim} anytime to reconfigure.${c.reset}
`);

  process.exit(0);
}

async function showConfigStatus() {
  const config = loadConfig();
  const providers = detectProviders();

  console.log(`\n${c.bold}agx Configuration${c.reset}\n`);

  if (config) {
    console.log(`  Config file: ${c.dim}~/.agx/config.json${c.reset}`);
    console.log(`  Default provider: ${c.cyan}${config.defaultProvider}${c.reset}`);
    const defaultModel = (config?.models && config.defaultProvider)
      ? config.models[config.defaultProvider]
      : (config?.defaultProvider === 'ollama' ? config?.ollama?.model : null);
    if (defaultModel) {
      console.log(`  Default model: ${c.cyan}${defaultModel}${c.reset}`);
    }
    if (config?.settingsMeta?.changedAt) {
      console.log(`  Settings changed: ${c.dim}${config.settingsMeta.changedAt}${c.reset} (${config.settingsMeta.provenance || 'unknown'})`);
    }
    const cloudConfig = loadCloudConfigFile();
    const cloudUrl = cloudConfig?.apiUrl || DEFAULT_API_URL;
    console.log(`  Backend URL: ${c.cyan}${cloudUrl}${c.reset}`);
  } else {
    console.log(`  ${c.yellow}Not configured${c.reset} - run ${c.cyan}agx init${c.reset}`);
  }

  printProviderStatus(providers);
  console.log('');
}

async function runConfigMenu() {
  const config = loadConfig();
  const providers = detectProviders();

  console.log(`\n${c.bold}agx Configuration${c.reset}\n`);

  console.log(`${c.bold}What would you like to do?${c.reset}\n`);
  console.log(`  ${c.cyan}1${c.reset}) Install a new provider`);
  console.log(`  ${c.cyan}2${c.reset}) Login to a provider`);
  console.log(`  ${c.cyan}3${c.reset}) Change default provider`);
  console.log(`  ${c.cyan}4${c.reset}) Set backend URL`);
  console.log(`  ${c.cyan}5${c.reset}) Show status`);
  console.log(`  ${c.cyan}6${c.reset}) Run full setup wizard`);
  console.log(`  ${c.cyan}q${c.reset}) Quit`);

  const choice = await prompt('\nChoice: ');

  switch (choice) {
    case '1': {
      const missing = ['claude', 'gemini', 'ollama', 'codex'].filter((p) => !providers[p]);
      if (missing.length === 0) {
        console.log(`\n${c.green}✓${c.reset} All providers are already installed!`);
        break;
      }
      console.log(`\n${c.bold}Available to install:${c.reset}\n`);
      missing.forEach((p, i) => {
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p} - ${PROVIDERS[p].description}`);
      });
      const pChoice = await prompt('\nChoice: ');
      const idx = parseInt(pChoice, 10) - 1;
      if (idx >= 0 && idx < missing.length) {
        await installProvider(missing[idx]);
      }
      break;
    }
    case '2': {
      const installed = Object.keys(providers).filter((p) => providers[p]);
      if (installed.length === 0) {
        console.log(`\n${c.yellow}No providers installed.${c.reset} Install one first.`);
        break;
      }
      console.log(`\n${c.bold}Login to:${c.reset}\n`);
      installed.forEach((p, i) => {
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}`);
      });
      const pChoice = await prompt('\nChoice: ');
      const idx = parseInt(pChoice, 10) - 1;
      if (idx >= 0 && idx < installed.length) {
        await loginProvider(installed[idx]);
      }
      break;
    }
    case '3': {
      const installed = Object.keys(providers).filter((p) => providers[p]);
      if (installed.length === 0) {
        console.log(`\n${c.yellow}No providers installed.${c.reset}`);
        break;
      }
      console.log(`\n${c.bold}Set default provider:${c.reset}\n`);
      installed.forEach((p, i) => {
        const current = config?.defaultProvider === p ? ` ${c.dim}(current)${c.reset}` : '';
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}${current}`);
      });
      const pChoice = await prompt('\nChoice: ');
      const idx = parseInt(pChoice, 10) - 1;
      if (idx >= 0 && idx < installed.length) {
        const newConfig = { ...(config || {}), defaultProvider: installed[idx] };
        saveConfig(newConfig);
        console.log(`\n${c.green}✓${c.reset} Default provider set to ${c.cyan}${installed[idx]}${c.reset}`);
      }
      break;
    }
    case '4': {
      const cloudConfig = loadCloudConfigFile();
      const currentUrl = cloudConfig?.apiUrl || DEFAULT_API_URL;
      console.log(`\n  Current backend URL: ${c.cyan}${currentUrl}${c.reset}`);
      const newUrl = await prompt(`\n  New URL [${c.dim}${currentUrl}${c.reset}]: `);
      if (newUrl && newUrl.trim()) {
        const updated = { ...(cloudConfig || {}), apiUrl: newUrl.trim() };
        saveCloudConfigFile(updated);
        console.log(`\n${c.green}✓${c.reset} Backend URL set to ${c.cyan}${newUrl.trim()}${c.reset}`);
      } else {
        console.log(`\n${c.dim}Keeping current URL${c.reset}`);
      }
      break;
    }
    case '5':
      await showConfigStatus();
      break;
    case '6':
      await runOnboarding();
      break;
    case 'q':
    case 'Q':
      break;
    default:
      console.log(`${c.yellow}Invalid choice${c.reset}`);
  }

  console.log('');
  process.exit(0);
}

module.exports = { runOnboarding, showConfigStatus, runConfigMenu };


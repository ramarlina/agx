/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const execa = require('execa');

const { c } = require('../ui/colors');
const { prompt, loadConfig } = require('./configStore');
const { detectProviders } = require('./providers');
const {
  isDaemonRunning,
  isBoardRunning,
  isTemporalWorkerRunning,
  startDaemon,
  stopDaemon,
  DAEMON_LOG_FILE,
  WORKER_LOG_FILE,
  BOARD_LOG_FILE,
} = require('./daemon');

async function runInteractiveMenu() {
  const providers = detectProviders();
  const config = loadConfig();

  const clearScreen = () => process.stdout.write('\x1b[2J\x1b[H');
  const hideCursor = () => process.stdout.write('\x1b[?25l');
  const showCursor = () => process.stdout.write('\x1b[?25h');

  let menuState = 'main';
  let selectedIdx = 0;
  let selectedProvider = null;

  const buildMainMenu = () => {
    const items = [];
    if (providers.claude) items.push({ id: 'claude', label: 'claude', desc: 'Anthropic Claude Code', type: 'provider' });
    if (providers.codex) items.push({ id: 'codex', label: 'codex', desc: 'OpenAI Codex', type: 'provider' });
    if (providers.gemini) items.push({ id: 'gemini', label: 'gemini', desc: 'Google Gemini', type: 'provider' });
    if (providers.ollama) items.push({ id: 'ollama', label: 'ollama', desc: 'Local Ollama', type: 'provider' });
    items.push({ id: 'sep1', type: 'separator' });
    items.push({ id: 'daemon', label: 'Daemon', desc: 'Background task runner', type: 'action' });
    return items;
  };

  const buildActionMenu = () => [
    { id: 'chat', label: 'Chat', desc: 'Start interactive conversation', type: 'action' },
    { id: 'sep', type: 'separator' },
    { id: 'back', label: '← Back', desc: '', type: 'back' },
  ];

  const buildDaemonMenu = () => {
    const pid = isDaemonRunning();
    const items = [];
    if (pid) items.push({ id: 'stop', label: 'Stop', desc: `Stop daemon (pid ${pid})`, type: 'action' });
    else items.push({ id: 'start', label: 'Start', desc: 'Start background daemon', type: 'action' });
    items.push({ id: 'status', label: 'Status', desc: 'Check daemon status', type: 'action' });
    items.push({ id: 'logs', label: 'Logs', desc: 'Show recent logs', type: 'action' });
    items.push({ id: 'sep', type: 'separator' });
    items.push({ id: 'back', label: '← Back', desc: '', type: 'back' });
    return items;
  };

  const getMenuItems = () => {
    switch (menuState) {
      case 'main': return buildMainMenu();
      case 'action': return buildActionMenu();
      case 'daemon': return buildDaemonMenu();
      default: return buildMainMenu();
    }
  };

  const render = () => {
    const items = getMenuItems();
    const clearLine = '\x1b[K';
    const home = '\x1b[H';
    const clearBelow = '\x1b[J';

    const lines = [];
    if (menuState === 'main') lines.push(`${c.bold}${c.cyan}agx${c.reset}  ${c.dim}Autonomous AI Agents${c.reset}`);
    else if (menuState === 'action' && selectedProvider) lines.push(`${c.bold}${c.cyan}agx${c.reset} ${c.dim}›${c.reset} ${c.bold}${selectedProvider}${c.reset}`);
    else if (menuState === 'daemon') lines.push(`${c.bold}${c.cyan}agx${c.reset} ${c.dim}›${c.reset} ${c.bold}Daemon${c.reset}`);
    lines.push('');

    items.forEach((item, idx) => {
      if (item.type === 'separator') {
        lines.push(`  ${c.dim}${'─'.repeat(40)}${c.reset}`);
        return;
      }
      const isSelected = idx === selectedIdx;
      const prefix = isSelected ? `${c.cyan}❯${c.reset}` : ' ';
      const label = isSelected ? `${c.bold}${item.label}${c.reset}` : item.label;
      const desc = item.desc ? `  ${c.dim}${item.desc}${c.reset}` : '';
      lines.push(`${prefix} ${label}${desc}`);
    });

    lines.push('');
    if (menuState === 'main') lines.push(`${c.dim}↑/↓ select · enter choose · q quit${c.reset}`);
    else lines.push(`${c.dim}↑/↓ select · enter choose · esc back · q quit${c.reset}`);

    process.stdout.write(home + lines.map((l) => l + clearLine).join('\n') + clearBelow);
  };

  const releaseTTY = () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    showCursor();
    clearScreen();
  };

  const handleBack = () => {
    if (menuState === 'action' || menuState === 'daemon') {
      menuState = 'main';
      selectedIdx = 0;
      render();
    }
  };

  const cleanup = () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    showCursor();
    clearScreen();
    process.exit(0);
  };

  const handleSelect = async () => {
    const items = getMenuItems();
    const item = items[selectedIdx];
    if (!item || item.type === 'separator') return;

    if (item.type === 'back') {
      handleBack();
      return;
    }

    if (menuState === 'main') {
      if (item.type === 'provider') {
        selectedProvider = item.id;
        menuState = 'action';
        selectedIdx = 0;
        render();
      } else if (item.id === 'daemon') {
        menuState = 'daemon';
        selectedIdx = 0;
        render();
      }
      return;
    }

    if (menuState === 'action') {
      releaseTTY();

      if (item.id === 'chat') {
        if (selectedProvider === 'ollama') {
          const ollamaModel = config?.ollama?.model || 'llama3.2:3b';
          const child = execa('claude', ['--dangerously-skip-permissions', '--model', ollamaModel], {
            stdio: 'inherit',
            env: {
              ...process.env,
              ANTHROPIC_AUTH_TOKEN: 'ollama',
              ANTHROPIC_BASE_URL: 'http://localhost:11434',
              ANTHROPIC_API_KEY: ''
            },
            reject: false,
          });
          child.on('close', (code) => process.exit(code || 0));
        } else {
          const child = execa(selectedProvider, [], { stdio: 'inherit', reject: false });
          child.on('close', (code) => process.exit(code || 0));
        }
      }
      return;
    }

    if (menuState === 'daemon') {
      showCursor();
      clearScreen();

      if (item.id === 'start') {
        startDaemon();
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        render();
        return;
      }
      if (item.id === 'stop') {
        await stopDaemon();
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        selectedIdx = 0;
        render();
        return;
      }
      if (item.id === 'status') {
        const pid = isDaemonRunning();
        if (pid) {
          console.log(`${c.green}Daemon running${c.reset} (pid ${pid})`);
          console.log(`${c.dim}Logs: ${DAEMON_LOG_FILE}${c.reset}`);
        } else {
          console.log(`${c.yellow}Daemon not running${c.reset}`);
        }
        const temporalPid = isTemporalWorkerRunning();
        if (temporalPid) {
          console.log(`${c.green}Orchestrator worker running${c.reset} (pid ${temporalPid})`);
          console.log(`${c.dim}Logs: ${WORKER_LOG_FILE}${c.reset}`);
        } else {
          console.log(`${c.yellow}Orchestrator worker not running${c.reset}`);
        }
        const boardPid = isBoardRunning();
        if (boardPid) {
          console.log(`${c.green}Board server running${c.reset} (pid ${boardPid})`);
          console.log(`${c.dim}Logs: ${BOARD_LOG_FILE}${c.reset}`);
        } else {
          console.log(`${c.yellow}Board server not running${c.reset}`);
        }
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        render();
        return;
      }
      if (item.id === 'logs') {
        if (fs.existsSync(DAEMON_LOG_FILE)) {
          const logs = fs.readFileSync(DAEMON_LOG_FILE, 'utf8');
          console.log(logs.split('\n').slice(-20).join('\n'));
        } else {
          console.log(`${c.dim}No logs yet${c.reset}`);
        }
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        render();
        return;
      }
    }
  };

  if (!process.stdin.isTTY) {
    const items = buildMainMenu().filter((i) => i.type !== 'separator');
    console.log(`${c.bold}${c.cyan}agx${c.reset}  ${c.dim}Autonomous AI Agents${c.reset}\n`);
    items.forEach((item, idx) => {
      console.log(`  ${c.cyan}${idx + 1}${c.reset}) ${item.label}  ${c.dim}${item.desc}${c.reset}`);
    });
    console.log(`  ${c.cyan}q${c.reset}) Quit\n`);

    const choice = await prompt('Choice: ');
    if (choice === 'q' || choice === 'Q') process.exit(0);

    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < items.length) {
      const item = items[idx];
      if (item.type === 'provider') {
        console.log(`\n${c.bold}${item.label}${c.reset}\n`);
        console.log(`  ${c.cyan}1${c.reset}) Chat`);
        console.log(`  ${c.cyan}0${c.reset}) Back\n`);
        const actionChoice = await prompt('Choice: ');
        if (actionChoice === '0') {
          execa(process.argv[0], [process.argv[1]], { stdio: 'inherit', reject: false }).on('close', (code) => process.exit(code || 0));
          return;
        }
        if (actionChoice === '1') {
          if (item.id === 'ollama') {
            const ollamaModel = config?.ollama?.model || 'llama3.2:3b';
            execa('claude', ['--dangerously-skip-permissions', '--model', ollamaModel], {
              stdio: 'inherit',
              env: {
                ...process.env,
                ANTHROPIC_AUTH_TOKEN: 'ollama',
                ANTHROPIC_BASE_URL: 'http://localhost:11434',
                ANTHROPIC_API_KEY: ''
              },
              reject: false,
            }).on('close', (code) => process.exit(code || 0));
          } else {
            execa(item.id, [], { stdio: 'inherit', reject: false }).on('close', (code) => process.exit(code || 0));
          }
        }
      } else if (item.id === 'daemon') {
        console.log(`\n${c.bold}Daemon${c.reset}\n`);
        const pid = isDaemonRunning();
        if (pid) console.log(`  ${c.cyan}1${c.reset}) Stop`);
        else console.log(`  ${c.cyan}1${c.reset}) Start`);
        console.log(`  ${c.cyan}2${c.reset}) Status`);
        console.log(`  ${c.cyan}3${c.reset}) Logs`);
        console.log(`  ${c.cyan}0${c.reset}) Back\n`);
        const dChoice = await prompt('Choice: ');
        if (dChoice === '0') {
          execa(process.argv[0], [process.argv[1]], { stdio: 'inherit', reject: false }).on('close', (code) => process.exit(code || 0));
          return;
        }
        if (dChoice === '1') {
          if (pid) await stopDaemon(); else startDaemon();
        } else if (dChoice === '2') {
          if (pid) console.log(`${c.green}Daemon running${c.reset} (pid ${pid})`);
          else console.log(`${c.yellow}Daemon not running${c.reset}`);
        } else if (dChoice === '3') {
          if (fs.existsSync(DAEMON_LOG_FILE)) {
            console.log(fs.readFileSync(DAEMON_LOG_FILE, 'utf8').split('\n').slice(-20).join('\n'));
          } else {
            console.log(`${c.dim}No logs yet${c.reset}`);
          }
        }
      }
    }
    process.exit(0);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  hideCursor();
  render();

  process.stdin.on('data', async (key) => {
    const k = key.toString();
    const items = getMenuItems();

    const findValidUp = (from) => {
      let idx = from - 1;
      while (idx >= 0 && items[idx]?.type === 'separator') idx -= 1;
      return idx >= 0 ? idx : from;
    };

    const findValidDown = (from) => {
      let idx = from + 1;
      while (idx < items.length && items[idx]?.type === 'separator') idx += 1;
      return idx < items.length ? idx : from;
    };

    if (k === 'q' || k === '\x03') { // q or ctrl-c
      cleanup();
    } else if (k === '\x1b[A' || k === 'k') { // up arrow or k
      selectedIdx = findValidUp(selectedIdx);
      render();
    } else if (k === '\x1b[B' || k === 'j') { // down arrow or j
      selectedIdx = findValidDown(selectedIdx);
      render();
    } else if (k === '\r' || k === '\n') { // enter
      await handleSelect();
    } else if (k === '\x1b[D' || k === 'h' || (k === '\x1b' && k.length === 1)) { // left arrow, h, or bare esc
      handleBack();
    }
  });
}

module.exports = { runInteractiveMenu };

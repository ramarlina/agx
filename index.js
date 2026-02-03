#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// agx skill - instructions for LLMs on how to use agx
const AGX_SKILL = `---
name: agx
description: Run AI agents with persistent memory. Wraps Claude, Gemini, Ollama with automatic state management.
---

# agx - AI Agent CLI with Persistent Memory

Run AI agents with automatic state persistence via mem integration.

## Basic Usage

\`\`\`bash
agx claude -p "explain this code"     # simple prompt
agx -p "what does this do?"           # use default provider
agx c --yolo -p "fix the bug"         # skip confirmations
\`\`\`

## Memory Integration

agx auto-detects \`~/.mem\` and loads context:

\`\`\`bash
# Auto-load context if task exists for cwd
agx claude -p "continue working"

# Auto-create task (non-interactive, for agents)
agx claude --autonomous -p "Build todo app"

# Explicit task with criteria
agx claude --task todo-app \\
  --criteria "CRUD working" \\
  --criteria "Deployed" \\
  -p "Build a todo app"
\`\`\`

## Output Markers

Use these in agent output to save state:

\`\`\`
[checkpoint: message]      Save progress point
[learn: insight]           Record learning
[next: step]               Set next step
[criteria: N]              Mark criterion #N complete
[approve: question]        Halt for human approval
[blocked: reason]          Mark blocked, stop
[pause]                    Save and stop (resume later)
[continue]                 Keep going (daemon mode)
[done]                     Mark task complete
[split: name "goal"]       Create subtask
\`\`\`

## Providers

| Provider | Aliases | Description |
|----------|---------|-------------|
| claude | c, cl | Anthropic Claude Code |
| gemini | g, gem | Google Gemini CLI |
| ollama | o, ol | Local Ollama models |

## Options

| Option | Description |
|--------|-------------|
| --prompt, -p | The prompt to send |
| --model, -m | Model name |
| --yolo, -y | Skip permission prompts |
| --mem | Enable mem (auto-detected) |
| --no-mem | Disable mem |
| --autonomous, -a | Create task and run autonomously until done |
| --task NAME | Specific task name |
| --criteria "..." | Success criterion (repeatable) |
| --daemon | Loop on [continue] marker |
| --until-done | Keep running until [done] |

## Continuous Work Loop

New tasks auto-set \`wake: every 15m\`. The loop:

\`\`\`
WAKE → load context → review → work → save → SLEEP
                                          ↓
                              repeat until [done]
\`\`\`

Agent keeps working by default. Only output stopping markers when needed:
- \`[done]\` → task complete, stop loop
- \`[blocked: reason]\` → need human help, pause loop
- \`[approve: question]\` → need approval, wait

Install wake: \`mem cron export >> crontab\`

## Task Splitting

Break large tasks into subtasks:

\`\`\`
[split: setup "Project scaffolding"]
[split: auth "Authentication system"]
[split: crud "CRUD operations"]
[next: Start with setup]
\`\`\`

Creates subtask branches in ~/.mem, linked to parent.
`;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

// Check if a command exists
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ==================== MEM INTEGRATION ====================

// Find .mem directory (walk up from cwd, or check ~/.mem)
function findMemDir(startDir = process.cwd()) {
  // First check local .mem
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const memDir = path.join(dir, '.mem');
    if (fs.existsSync(memDir) && fs.existsSync(path.join(memDir, '.git'))) {
      return { memDir, taskBranch: null, projectDir: dir, isLocal: true };
    }
    dir = path.dirname(dir);
  }
  
  // Then check ~/.mem with index
  const globalMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
  if (fs.existsSync(globalMem)) {
    const indexFile = path.join(globalMem, 'index.json');
    if (fs.existsSync(indexFile)) {
      try {
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        // Exact match
        if (index[startDir]) {
          return { memDir: globalMem, taskBranch: index[startDir], projectDir: startDir, isLocal: false };
        }
        // Check parent directories (for monorepo/subdirectory usage)
        let checkDir = startDir;
        while (checkDir !== path.dirname(checkDir)) {
          checkDir = path.dirname(checkDir);
          if (index[checkDir]) {
            return { memDir: globalMem, taskBranch: index[checkDir], projectDir: checkDir, isLocal: false };
          }
        }
      } catch {}
    }
  }
  
  return null;
}

// Load mem context for a specific task
function loadMemContext(memInfo) {
  try {
    // If we know the task branch, switch to it first to ensure correct context
    if (memInfo.taskBranch && !memInfo.isLocal) {
      try {
        execSync(`git checkout ${memInfo.taskBranch}`, { 
          cwd: memInfo.memDir, 
          stdio: ['pipe', 'pipe', 'pipe'] 
        });
      } catch {}
    }
    
    // Run mem context from the project directory
    const result = execSync('mem context', { 
      cwd: memInfo.projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch {
    return null;
  }
}

// Parse output markers
function parseMemMarkers(output) {
  const markers = [];
  const patterns = [
    { type: 'checkpoint', regex: /\[checkpoint:\s*([^\]]+)\]/gi },
    { type: 'learn', regex: /\[learn:\s*([^\]]+)\]/gi },
    { type: 'next', regex: /\[next:\s*([^\]]+)\]/gi },
    { type: 'stuck', regex: /\[stuck:\s*([^\]]+)\]/gi },
    { type: 'blocked', regex: /\[blocked:\s*([^\]]+)\]/gi },
    { type: 'done', regex: /\[done\]/gi },
    { type: 'pause', regex: /\[pause(?::\s*([^\]]*))?\]/gi },
    { type: 'continue', regex: /\[continue\]/gi },
    { type: 'approve', regex: /\[approve:\s*([^\]]+)\]/gi },
    { type: 'criteria', regex: /\[criteria:\s*(\d+)\]/gi },
    { type: 'split', regex: /\[split:\s*([^\s\]]+)(?:\s+"([^"]+)")?\]/gi },
  ];
  
  for (const { type, regex } of patterns) {
    let match;
    while ((match = regex.exec(output)) !== null) {
      if (type === 'split') {
        markers.push({ type, name: match[1], goal: match[2] || match[1] });
      } else {
        markers.push({ type, value: match[1] || true });
      }
    }
  }
  
  return markers;
}

// Apply mem markers - returns control signals
function applyMemMarkers(markers, memInfo) {
  // Use project directory for commands (not parent of ~/.mem)
  const workDir = memInfo.projectDir || path.dirname(memInfo.memDir || memInfo);
  const result = {
    approvals: [],
    shouldContinue: false,
    shouldPause: false,
    isDone: false,
    isBlocked: false,
    splits: []
  };
  
  for (const marker of markers) {
    try {
      switch (marker.type) {
        case 'checkpoint':
          execSync(`mem checkpoint "${marker.value.replace(/"/g, '\\"')}"`, { 
            cwd: workDir, stdio: 'ignore' 
          });
          console.log(`${c.green}✓${c.reset} ${c.dim}Checkpoint:${c.reset} ${marker.value}`);
          break;
        case 'learn':
          execSync(`mem learn "${marker.value.replace(/"/g, '\\"')}"`, { 
            cwd: workDir, stdio: 'ignore' 
          });
          console.log(`${c.green}✓${c.reset} ${c.dim}Learned:${c.reset} ${marker.value}`);
          break;
        case 'next':
          execSync(`mem next "${marker.value.replace(/"/g, '\\"')}"`, { 
            cwd: workDir, stdio: 'ignore' 
          });
          console.log(`${c.green}✓${c.reset} ${c.dim}Next:${c.reset} ${marker.value}`);
          break;
        case 'stuck':
        case 'blocked':
          execSync(`mem stuck "${marker.value.replace(/"/g, '\\"')}"`, { 
            cwd: workDir, stdio: 'ignore' 
          });
          console.log(`${c.yellow}⚠${c.reset} ${c.dim}Blocked:${c.reset} ${marker.value}`);
          result.isBlocked = true;
          break;
        case 'done':
          console.log(`${c.green}✓${c.reset} ${c.dim}Task marked done${c.reset}`);
          result.isDone = true;
          break;
        case 'pause':
          console.log(`${c.cyan}⏸${c.reset} ${c.dim}Pausing${marker.value ? ': ' + marker.value : ''}${c.reset}`);
          result.shouldPause = true;
          break;
        case 'continue':
          console.log(`${c.cyan}▶${c.reset} ${c.dim}Continuing...${c.reset}`);
          result.shouldContinue = true;
          break;
        case 'approve':
          result.approvals.push(marker.value);
          break;
        case 'criteria':
          execSync(`mem criteria ${marker.value}`, { 
            cwd: workDir, stdio: 'ignore' 
          });
          console.log(`${c.green}✓${c.reset} ${c.dim}Criteria #${marker.value} complete${c.reset}`);
          break;
        case 'split':
          result.splits.push({ name: marker.name, goal: marker.goal });
          console.log(`${c.cyan}⑂${c.reset} ${c.dim}Split:${c.reset} ${marker.name} - ${marker.goal}`);
          break;
      }
    } catch (err) {
      console.error(`${c.red}mem error:${c.reset} ${err.message}`);
    }
  }
  
  return result;
}

// Create subtasks from split markers
function createSubtasks(splits, memInfo) {
  const workDir = memInfo.projectDir || path.dirname(memInfo.memDir || memInfo);
  
  for (const split of splits) {
    try {
      // Create subtask as new branch
      execSync(`mem init ${split.name} "${split.goal.replace(/"/g, '\\"')}"`, {
        cwd: workDir,
        stdio: 'ignore'
      });
      console.log(`${c.green}✓${c.reset} Created subtask: ${c.bold}${split.name}${c.reset}`);
    } catch (err) {
      console.error(`${c.red}Failed to create subtask ${split.name}:${c.reset} ${err.message}`);
    }
  }
}

// ==================== DAEMON ====================

const DAEMON_PID_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'daemon.pid');
const DAEMON_LOG_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'daemon.log');

function isDaemonRunning() {
  try {
    if (!fs.existsSync(DAEMON_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim());
    process.kill(pid, 0); // Check if process exists
    return pid;
  } catch {
    return false;
  }
}

function startDaemon() {
  const existingPid = isDaemonRunning();
  if (existingPid) {
    console.log(`${c.dim}Daemon already running (pid ${existingPid})${c.reset}`);
    return existingPid;
  }

  // Ensure .agx directory exists
  const agxDir = path.dirname(DAEMON_PID_FILE);
  if (!fs.existsSync(agxDir)) {
    fs.mkdirSync(agxDir, { recursive: true });
  }

  // Spawn daemon process
  const agxPath = process.argv[1]; // Current script path
  const daemon = spawn(process.execPath, [agxPath, 'daemon', '--run'], {
    detached: true,
    stdio: ['ignore', 
      fs.openSync(DAEMON_LOG_FILE, 'a'), 
      fs.openSync(DAEMON_LOG_FILE, 'a')
    ],
    env: { ...process.env, AGX_DAEMON: '1' }
  });

  daemon.unref();
  fs.writeFileSync(DAEMON_PID_FILE, String(daemon.pid));
  
  console.log(`${c.green}✓${c.reset} Daemon started (pid ${daemon.pid})`);
  console.log(`${c.dim}  Logs: ${DAEMON_LOG_FILE}${c.reset}`);
  
  return daemon.pid;
}

function stopDaemon() {
  const pid = isDaemonRunning();
  if (!pid) {
    console.log(`${c.yellow}Daemon not running${c.reset}`);
    return false;
  }
  
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(DAEMON_PID_FILE);
    console.log(`${c.green}✓${c.reset} Daemon stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop daemon:${c.reset} ${err.message}`);
    return false;
  }
}

async function runDaemon() {
  console.log(`[${new Date().toISOString()}] Daemon starting...`);
  
  const WAKE_INTERVAL = 15 * 60 * 1000; // 15 minutes
  
  const tick = async () => {
    console.log(`[${new Date().toISOString()}] Daemon tick - checking tasks...`);
    
    const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
    const indexFile = path.join(memDir, 'index.json');
    
    if (!fs.existsSync(indexFile)) {
      console.log(`[${new Date().toISOString()}] No tasks found`);
      return;
    }
    
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    
    for (const [projectDir, taskBranch] of Object.entries(index)) {
      if (!fs.existsSync(projectDir)) continue;
      
      // Check if task is active
      try {
        execSync(`git checkout ${taskBranch}`, { cwd: memDir, stdio: 'ignore' });
        const state = fs.readFileSync(path.join(memDir, 'state.md'), 'utf8');
        
        if (state.includes('status: active')) {
          console.log(`[${new Date().toISOString()}] Continuing task: ${taskBranch} in ${projectDir}`);
          
          // Run agx continue
          try {
            execSync(`agx claude -y -p "continue"`, { 
              cwd: projectDir, 
              stdio: 'inherit',
              timeout: 10 * 60 * 1000 // 10 min timeout
            });
          } catch (err) {
            console.log(`[${new Date().toISOString()}] Task ${taskBranch} error: ${err.message}`);
          }
        }
      } catch (err) {
        console.log(`[${new Date().toISOString()}] Error checking ${taskBranch}: ${err.message}`);
      }
    }
  };
  
  // Initial tick
  await tick();
  
  // Schedule recurring ticks
  setInterval(tick, WAKE_INTERVAL);
  
  // Keep alive
  console.log(`[${new Date().toISOString()}] Daemon running, wake interval: ${WAKE_INTERVAL / 1000 / 60}m`);
}

// Handle approval prompts
async function handleApprovals(approvals) {
  if (approvals.length === 0) return true;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  for (const approval of approvals) {
    const answer = await new Promise(resolve => {
      rl.question(`\n${c.yellow}⚠ APPROVAL REQUIRED:${c.reset} ${approval}\n${c.dim}Continue? [y/N]:${c.reset} `, resolve);
    });
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(`${c.red}✗${c.reset} Rejected. Workflow halted.`);
      rl.close();
      return false;
    }
    console.log(`${c.green}✓${c.reset} Approved.`);
  }
  
  rl.close();
  return true;
}

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

// Save config
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Interactive prompt helper
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Detect available providers
function detectProviders() {
  return {
    claude: commandExists('claude'),
    gemini: commandExists('gemini'),
    ollama: commandExists('ollama')
  };
}

// Print provider status
function printProviderStatus(providers) {
  console.log(`\n${c.bold}Detected Providers:${c.reset}\n`);

  const status = (installed) => installed
    ? `${c.green}✓ installed${c.reset}`
    : `${c.dim}✗ not found${c.reset}`;

  console.log(`  ${c.cyan}claude${c.reset}  │ Anthropic Claude Code  │ ${status(providers.claude)}`);
  console.log(`  ${c.cyan}gemini${c.reset}  │ Google Gemini CLI      │ ${status(providers.gemini)}`);
  console.log(`  ${c.cyan}ollama${c.reset}  │ Local Ollama           │ ${status(providers.ollama)}`);
}

// Run a command with inherited stdio (interactive)
function runInteractive(cmd, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// Run a command silently and return success
function runSilent(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if ollama server is running
function isOllamaRunning() {
  try {
    execSync('curl -s http://localhost:11434/api/tags', { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// Get list of ollama models
function getOllamaModels() {
  try {
    const result = execSync('ollama list 2>/dev/null', { encoding: 'utf8' });
    const lines = result.trim().split('\n').slice(1); // skip header
    return lines.map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

// ==================== SKILL ====================

// View the agx skill
function showSkill() {
  console.log(AGX_SKILL);
}

// Check if skill is installed for a provider
function isSkillInstalled(provider) {
  const skillDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    provider === 'claude' ? '.claude' : '.gemini',
    'skills',
    'agx'
  );
  return fs.existsSync(path.join(skillDir, 'SKILL.md'));
}

// Install agx skill to a provider's skills directory
function installSkillTo(provider) {
  const baseDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    provider === 'claude' ? '.claude' : '.gemini',
    'skills',
    'agx'
  );

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  fs.writeFileSync(path.join(baseDir, 'SKILL.md'), AGX_SKILL);
  return baseDir;
}

// Handle skill command
async function handleSkillCommand(args) {
  const subCmd = args[1];

  if (!subCmd || subCmd === 'view' || subCmd === 'show') {
    // Show skill content
    console.log(`\n${c.bold}${c.cyan}/agx${c.reset} - ${c.dim}LLM instructions for using agx${c.reset}\n`);

    // Check installation status
    const claudeInstalled = isSkillInstalled('claude');
    const geminiInstalled = isSkillInstalled('gemini');

    if (claudeInstalled || geminiInstalled) {
      console.log(`${c.green}Installed:${c.reset}`);
      if (claudeInstalled) console.log(`  ${c.dim}~/.claude/skills/agx/SKILL.md${c.reset}`);
      if (geminiInstalled) console.log(`  ${c.dim}~/.gemini/skills/agx/SKILL.md${c.reset}`);
      console.log('');
    }

    console.log(c.dim + '─'.repeat(60) + c.reset);
    console.log(AGX_SKILL);
    console.log(c.dim + '─'.repeat(60) + c.reset);

    if (!claudeInstalled && !geminiInstalled) {
      console.log(`\n${c.dim}Install with: ${c.reset}agx skill install`);
    }
    console.log('');
    return;
  }

  if (subCmd === 'install' || subCmd === 'add') {
    const target = args[2]; // optional: claude, gemini, or all

    console.log(`\n${c.bold}Install agx skill${c.reset}\n`);

    if (!target || target === 'all') {
      // Install to all available
      const providers = detectProviders();
      let installed = 0;

      if (providers.claude) {
        const dest = installSkillTo('claude');
        console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
        installed++;
      }

      if (providers.gemini) {
        const dest = installSkillTo('gemini');
        console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
        installed++;
      }

      if (installed === 0) {
        console.log(`${c.yellow}No providers installed.${c.reset} Run ${c.cyan}agx init${c.reset} first.`);
      } else {
        console.log(`\n${c.dim}LLMs can now use /agx to learn how to run agx commands.${c.reset}\n`);
      }
    } else if (target === 'claude' || target === 'gemini') {
      const dest = installSkillTo(target);
      console.log(`${c.green}✓${c.reset} Installed to ${c.dim}${dest}${c.reset}`);
      console.log(`\n${c.dim}LLMs can now use /agx to learn how to run agx commands.${c.reset}\n`);
    } else {
      console.log(`${c.yellow}Unknown target:${c.reset} ${target}`);
      console.log(`${c.dim}Usage: agx skill install [claude|gemini|all]${c.reset}\n`);
    }
    return;
  }

  // Unknown subcommand
  console.log(`${c.bold}agx skill${c.reset} - Manage the agx skill for LLMs\n`);
  console.log(`${c.dim}Commands:${c.reset}`);
  console.log(`  ${c.cyan}agx skill${c.reset}              View the skill content`);
  console.log(`  ${c.cyan}agx skill install${c.reset}      Install to all providers`);
  console.log(`  ${c.cyan}agx skill install claude${c.reset}  Install to Claude only`);
  console.log('');
}

// ==================== PROVIDERS ====================

// Provider installation info
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
  }
};

// Install a provider
async function installProvider(provider) {
  const info = PROVIDERS[provider];
  if (!info) return false;

  console.log(`\n${c.cyan}Installing ${info.name}...${c.reset}\n`);
  console.log(`${c.dim}$ ${info.installCmd}${c.reset}\n`);

  const success = await runInteractive(info.installCmd);

  if (success && commandExists(provider)) {
    console.log(`\n${c.green}✓${c.reset} ${info.name} installed successfully!`);
    return true;
  } else {
    console.log(`\n${c.red}✗${c.reset} Installation failed. Try manually:`);
    console.log(`  ${c.dim}${info.installCmd}${c.reset}`);
    return false;
  }
}

// Login/authenticate a provider
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
    // Check if server is running
    if (!isOllamaRunning()) {
      console.log(`${c.yellow}Ollama server is not running.${c.reset}`);
      const startIt = await prompt(`Start it now? [Y/n]: `);
      if (startIt.toLowerCase() !== 'n') {
        console.log(`\n${c.cyan}Starting Ollama server in background...${c.reset}`);
        spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        }).unref();
        // Wait a moment for startup
        await new Promise(r => setTimeout(r, 2000));
        if (isOllamaRunning()) {
          console.log(`${c.green}✓${c.reset} Ollama server started!`);
        } else {
          console.log(`${c.yellow}Server may still be starting. Run ${c.reset}ollama serve${c.yellow} manually if needed.${c.reset}`);
        }
      }
    } else {
      console.log(`${c.green}✓${c.reset} Ollama server is running`);
    }

    // Check for models
    const models = getOllamaModels();
    if (models.length === 0) {
      console.log(`\n${c.yellow}No models installed.${c.reset}`);
      console.log(`\n${c.bold}Popular models:${c.reset}`);
      console.log(`  ${c.cyan}1${c.reset}) qwen3:8b      ${c.dim}(4.9 GB) - Great all-rounder${c.reset}`);
      console.log(`  ${c.cyan}2${c.reset}) llama3.2:3b   ${c.dim}(2.0 GB) - Fast & lightweight${c.reset}`);
      console.log(`  ${c.cyan}3${c.reset}) codellama:7b  ${c.dim}(3.8 GB) - Code specialist${c.reset}`);
      console.log(`  ${c.cyan}4${c.reset}) mistral:7b    ${c.dim}(4.1 GB) - Good general model${c.reset}`);
      console.log(`  ${c.cyan}5${c.reset}) Skip for now`);

      const choice = await prompt(`\nWhich model to pull? [1]: `);
      const modelMap = {
        '1': 'qwen3:8b',
        '2': 'llama3.2:3b',
        '3': 'codellama:7b',
        '4': 'mistral:7b',
        '': 'qwen3:8b'
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

  return false;
}

// Run onboarding
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

  // Offer to install missing providers
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

    // Re-detect after installations
    providers = detectProviders();
    available = Object.entries(providers)
      .filter(([_, installed]) => installed)
      .map(([name]) => name);
  }

  // No providers available
  if (available.length === 0) {
    console.log(`\n${c.yellow}⚠${c.reset}  No AI providers installed.\n`);
    console.log(`${c.dim}Run ${c.reset}agx init${c.dim} again to install providers.${c.reset}\n`);
    process.exit(0);
  }

  console.log(`\n${c.green}✓${c.reset} Available providers: ${c.bold}${available.join(', ')}${c.reset}`);

  // Ask for default provider
  let defaultProvider = available[0];

  if (available.length > 1) {
    console.log(`\n${c.bold}Choose your default provider:${c.reset}`);
    available.forEach((p, i) => {
      console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}`);
    });

    const choice = await prompt(`\nEnter number [${c.dim}1${c.reset}]: `);
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < available.length) {
      defaultProvider = available[idx];
    }
  }

  // Save config
  const config = {
    version: 1,
    defaultProvider,
    initialized: true,
    providers: providers
  };
  saveConfig(config);

  console.log(`\n${c.green}✓${c.reset} Configuration saved to ${c.dim}~/.agx/config.json${c.reset}`);
  console.log(`${c.green}✓${c.reset} Default provider: ${c.bold}${c.cyan}${defaultProvider}${c.reset}`);

  // Show quick start
  console.log(`
${c.bold}Quick Start:${c.reset}

  ${c.dim}# Use default provider (${defaultProvider})${c.reset}
  ${c.cyan}agx --prompt "hello world"${c.reset}

  ${c.dim}# Or specify a provider${c.reset}
  ${c.cyan}agx ${defaultProvider} --prompt "explain this code"${c.reset}

  ${c.dim}# Interactive mode${c.reset}
  ${c.cyan}agx ${defaultProvider} -i --prompt "let's chat"${c.reset}

  ${c.dim}# Show help${c.reset}
  ${c.cyan}agx --help${c.reset}

${c.dim}Run ${c.reset}agx init${c.dim} anytime to reconfigure.${c.reset}
`);

  process.exit(0);
}

// Show current config status
async function showConfigStatus() {
  const config = loadConfig();
  const providers = detectProviders();

  console.log(`\n${c.bold}agx Configuration${c.reset}\n`);

  if (config) {
    console.log(`  Config file: ${c.dim}~/.agx/config.json${c.reset}`);
    console.log(`  Default provider: ${c.cyan}${config.defaultProvider}${c.reset}`);
  } else {
    console.log(`  ${c.yellow}Not configured${c.reset} - run ${c.cyan}agx init${c.reset}`);
  }

  printProviderStatus(providers);
  console.log('');
}

// Run config menu
async function runConfigMenu() {
  const config = loadConfig();
  const providers = detectProviders();

  console.log(`\n${c.bold}agx Configuration${c.reset}\n`);

  console.log(`${c.bold}What would you like to do?${c.reset}\n`);
  console.log(`  ${c.cyan}1${c.reset}) Install a new provider`);
  console.log(`  ${c.cyan}2${c.reset}) Login to a provider`);
  console.log(`  ${c.cyan}3${c.reset}) Change default provider`);
  console.log(`  ${c.cyan}4${c.reset}) Show status`);
  console.log(`  ${c.cyan}5${c.reset}) Run full setup wizard`);
  console.log(`  ${c.cyan}q${c.reset}) Quit`);

  const choice = await prompt(`\nChoice: `);

  switch (choice) {
    case '1': {
      // Install a provider
      const missing = ['claude', 'gemini', 'ollama'].filter(p => !providers[p]);
      if (missing.length === 0) {
        console.log(`\n${c.green}✓${c.reset} All providers are already installed!`);
        break;
      }
      console.log(`\n${c.bold}Available to install:${c.reset}\n`);
      missing.forEach((p, i) => {
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p} - ${PROVIDERS[p].description}`);
      });
      const pChoice = await prompt(`\nChoice: `);
      const idx = parseInt(pChoice) - 1;
      if (idx >= 0 && idx < missing.length) {
        await installProvider(missing[idx]);
      }
      break;
    }
    case '2': {
      // Login to a provider
      const installed = Object.keys(providers).filter(p => providers[p]);
      if (installed.length === 0) {
        console.log(`\n${c.yellow}No providers installed.${c.reset} Install one first.`);
        break;
      }
      console.log(`\n${c.bold}Login to:${c.reset}\n`);
      installed.forEach((p, i) => {
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}`);
      });
      const pChoice = await prompt(`\nChoice: `);
      const idx = parseInt(pChoice) - 1;
      if (idx >= 0 && idx < installed.length) {
        await loginProvider(installed[idx]);
      }
      break;
    }
    case '3': {
      // Change default provider
      const installed = Object.keys(providers).filter(p => providers[p]);
      if (installed.length === 0) {
        console.log(`\n${c.yellow}No providers installed.${c.reset}`);
        break;
      }
      console.log(`\n${c.bold}Set default provider:${c.reset}\n`);
      installed.forEach((p, i) => {
        const current = config?.defaultProvider === p ? ` ${c.dim}(current)${c.reset}` : '';
        console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p}${current}`);
      });
      const pChoice = await prompt(`\nChoice: `);
      const idx = parseInt(pChoice) - 1;
      if (idx >= 0 && idx < installed.length) {
        const newConfig = { ...config, defaultProvider: installed[idx] };
        saveConfig(newConfig);
        console.log(`\n${c.green}✓${c.reset} Default provider set to ${c.cyan}${installed[idx]}${c.reset}`);
      }
      break;
    }
    case '4':
      await showConfigStatus();
      break;
    case '5':
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

// Check for commands or first run
async function checkOnboarding() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Init/setup command
  if (cmd === 'init' || cmd === 'setup') {
    await runOnboarding();
    return true;
  }

  // Config menu
  if (cmd === 'config') {
    await runConfigMenu();
    return true;
  }

  // Status command
  if (cmd === 'status') {
    await showConfigStatus();
    process.exit(0);
    return true;
  }

  // Skill command
  if (cmd === 'skill') {
    await handleSkillCommand(args);
    process.exit(0);
    return true;
  }

  // Daemon commands
  if (cmd === 'daemon') {
    const subcmd = args[1];
    if (subcmd === 'start') {
      startDaemon();
      process.exit(0);
    } else if (subcmd === 'stop') {
      stopDaemon();
      process.exit(0);
    } else if (subcmd === 'status') {
      const pid = isDaemonRunning();
      if (pid) {
        console.log(`${c.green}Daemon running${c.reset} (pid ${pid})`);
        console.log(`${c.dim}Logs: ${DAEMON_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Daemon not running${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'logs') {
      if (fs.existsSync(DAEMON_LOG_FILE)) {
        const logs = fs.readFileSync(DAEMON_LOG_FILE, 'utf8');
        console.log(logs.split('\n').slice(-50).join('\n'));
      } else {
        console.log(`${c.dim}No logs yet${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === '--run') {
      // Internal: actually run the daemon loop
      await runDaemon();
      return true; // Never exits
    } else {
      console.log(`${c.bold}agx daemon${c.reset} - Background task runner\n`);
      console.log(`Commands:`);
      console.log(`  agx daemon start   Start the daemon`);
      console.log(`  agx daemon stop    Stop the daemon`);
      console.log(`  agx daemon status  Check if running`);
      console.log(`  agx daemon logs    Show recent logs`);
      process.exit(0);
    }
    return true;
  }

  // Login command
  if (cmd === 'login') {
    const provider = args[1];
    if (!provider) {
      console.log(`${c.yellow}Usage:${c.reset} agx login <provider>`);
      console.log(`${c.dim}Providers: claude, gemini, ollama${c.reset}`);
      process.exit(1);
    }
    if (!['claude', 'gemini', 'ollama'].includes(provider)) {
      console.log(`${c.red}Unknown provider:${c.reset} ${provider}`);
      process.exit(1);
    }
    if (!commandExists(provider)) {
      console.log(`${c.yellow}${provider} is not installed.${c.reset}`);
      const answer = await prompt(`Install it now? [Y/n]: `);
      if (answer.toLowerCase() !== 'n') {
        await installProvider(provider);
      } else {
        process.exit(1);
      }
    }
    await loginProvider(provider);
    process.exit(0);
    return true;
  }

  // Add/install command
  if (cmd === 'add' || cmd === 'install') {
    const provider = args[1];
    if (!provider) {
      console.log(`${c.yellow}Usage:${c.reset} agx add <provider>`);
      console.log(`${c.dim}Providers: claude, gemini, ollama${c.reset}`);
      process.exit(1);
    }
    if (!['claude', 'gemini', 'ollama'].includes(provider)) {
      console.log(`${c.red}Unknown provider:${c.reset} ${provider}`);
      process.exit(1);
    }
    if (commandExists(provider)) {
      console.log(`${c.green}✓${c.reset} ${provider} is already installed!`);
      const answer = await prompt(`Run login/setup? [Y/n]: `);
      if (answer.toLowerCase() !== 'n') {
        await loginProvider(provider);
      }
    } else {
      const success = await installProvider(provider);
      if (success) {
        const answer = await prompt(`\nRun login/setup? [Y/n]: `);
        if (answer.toLowerCase() !== 'n') {
          await loginProvider(provider);
        }
      }
    }
    process.exit(0);
    return true;
  }

  // First run detection
  const config = loadConfig();
  if (!config && !args.includes('--help') && !args.includes('-h')) {
    console.log(`${c.cyan}First time using agx? Let's get you set up!${c.reset}\n`);
    await runOnboarding();
    return true;
  }

  return false;
}

// Main execution
(async () => {
  if (await checkOnboarding()) return;

const args = process.argv.slice(2);
let provider = args[0];
const config = loadConfig();

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

// Handle help
if (args.includes('--help') || args.includes('-h')) {
  const defaultNote = config?.defaultProvider
    ? `\n  Default provider: ${config.defaultProvider} (from ~/.agx/config.json)`
    : '';
  console.log(`agx - Unified AI Agent CLI

SYNTAX:
  agx [options] --prompt "<prompt>"          Use default provider
  agx <provider> [options] --prompt "<prompt>"

PROVIDERS:
  gemini, gem, g     Google Gemini
  claude, cl, c      Anthropic Claude
  ollama, ol, o      Local Ollama (via Claude interface)${defaultNote}

OPTIONS:
  --prompt, -p <text>    The prompt to send (recommended for clarity)
  --model, -m <name>     Model name to use
  --yolo, -y             Skip permission prompts
  --print                Non-interactive mode (output and exit)
  --interactive, -i      Force interactive mode
  --sandbox, -s          Enable sandbox (gemini only)
  --debug, -d            Enable debug output
  --mcp <config>         MCP config file (claude/ollama only)

COMMANDS:
  init, setup            Run setup wizard
  config                 Configuration menu
  add <provider>         Install a provider (claude, gemini, ollama)
  login <provider>       Login/authenticate to a provider
  status                 Show current configuration
  skill                  View agx skill (LLM instructions)
  skill install          Install skill to Claude/Gemini

EXAMPLES:
  agx --prompt "hello"                        Use default provider
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

// Detect if first arg is a provider or an option
const isProviderArg = provider && PROVIDER_ALIASES[provider.toLowerCase()];

// If no provider specified, use default from config
if (!provider || (!isProviderArg && provider.startsWith('-'))) {
  if (config?.defaultProvider) {
    // Shift: treat current args as options, use default provider
    if (provider && provider.startsWith('-')) {
      // First arg is an option, not a provider
      provider = config.defaultProvider;
    } else if (!provider) {
      provider = config.defaultProvider;
    }
  } else {
    console.log(`${c.yellow}No provider specified and no default configured.${c.reset}`);
    console.log(`\nRun ${c.cyan}agx init${c.reset} to set up, or specify a provider:\n`);
    console.log(`  ${c.dim}agx claude --prompt "hello"${c.reset}`);
    console.log(`  ${c.dim}agx gemini --prompt "hello"${c.reset}`);
    console.log(`  ${c.dim}agx ollama --prompt "hello"${c.reset}\n`);
    process.exit(1);
  }
}

// Resolve provider
const resolvedProvider = PROVIDER_ALIASES[provider.toLowerCase()];
if (!resolvedProvider) {
  console.error(`${c.red}Error:${c.reset} Unknown provider "${provider}"`);
  console.error(`Valid providers: ${VALID_PROVIDERS.join(', ')}`);
  process.exit(1);
}
provider = resolvedProvider;

// Determine remaining args - if first arg wasn't a provider, include it
const remainingArgs = isProviderArg ? args.slice(1) : args;
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
  mcp: null,
  mem: false,
  memDir: null,
  autonomous: false,
  taskName: null,
  criteria: [],
  daemon: false,
  untilDone: false,
  wakeInterval: null
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
    case '--mem':
      options.mem = true;
      break;
    case '--no-mem':
      options.mem = false;
      break;
    case '--autonomous':
    case '--auto':
    case '-a':
      options.autonomous = true;
      options.mem = true;
      break;
    case '--task':
      if (nextArg && !nextArg.startsWith('-')) {
        options.taskName = nextArg;
        options.mem = true;
        i++;
      }
      break;
    case '--criteria':
      if (nextArg && !nextArg.startsWith('-')) {
        options.criteria.push(nextArg);
        i++;
      }
      break;
    case '--daemon':
      options.daemon = true;
      break;
    case '--until-done':
      options.untilDone = true;
      options.daemon = true;
      break;
    case '--wake':
      if (nextArg && !nextArg.startsWith('-')) {
        options.wakeInterval = nextArg;
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
  // Default to --print when prompt is provided and --interactive not specified
  if (options.print || (finalPrompt && !options.interactive)) {
    translatedArgs.push('--print');
  }
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

// ==================== MEM INTEGRATION ====================

// Auto-detect mem if .mem exists (unless --no-mem)
let memInfo = options.mem !== false ? findMemDir() : null;
if (memInfo && options.mem !== false) {
  options.mem = true;
  options.memInfo = memInfo;
  options.memDir = memInfo.memDir; // For backwards compat
}

// Auto-create task if --autonomous or --task specified but no mem found
if ((options.autonomous || options.taskName) && !options.memInfo && finalPrompt) {
  const taskName = options.taskName || finalPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 3)
    .join('-');
  
  console.log(`${c.dim}[mem] Creating task: ${taskName}${c.reset}`);
  
  try {
    // Build criteria args
    const criteriaArgs = options.criteria.length 
      ? options.criteria.map(c => `--criteria "${c}"`).join(' ')
      : '';
    
    // Create task non-interactively
    const centralMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
    
    // Ensure central mem exists
    if (!fs.existsSync(centralMem)) {
      fs.mkdirSync(centralMem, { recursive: true });
      execSync('git init', { cwd: centralMem, stdio: 'ignore' });
      fs.writeFileSync(path.join(centralMem, 'playbook.md'), '# Playbook\n\nGlobal learnings that transfer across tasks.\n');
      execSync('git add -A && git commit -m "init: memory repo"', { cwd: centralMem, stdio: 'ignore', shell: true });
    }
    
    // Create task branch
    const branch = `task/${taskName}`;
    try {
      execSync(`git checkout main`, { cwd: centralMem, stdio: 'ignore' });
    } catch {}
    execSync(`git checkout -b ${branch}`, { cwd: centralMem, stdio: 'ignore' });
    
    // Create task files
    const today = new Date().toISOString().split('T')[0];
    const criteriaText = options.criteria.length 
      ? options.criteria.map(c => `- [ ] ${c}`).join('\n')
      : '- [ ] Define success criteria';
    
    fs.writeFileSync(path.join(centralMem, 'goal.md'), 
      `---\ntask: ${taskName}\ncreated: ${today}\n---\n\n# Goal\n\n${finalPrompt}\n\n## Definition of Done\n\n${criteriaText}\n\n## Progress: 0%`);
    fs.writeFileSync(path.join(centralMem, 'state.md'),
      `---\nstatus: active\n---\n\n# State\n\n## Next Step\n\nBegin work\n\n## Checkpoints\n\n- [ ] Started`);
    fs.writeFileSync(path.join(centralMem, 'memory.md'), '# Learnings\n\n');
    
    execSync('git add -A && git commit -m "init: ' + taskName + '"', { cwd: centralMem, stdio: 'ignore', shell: true });
    
    // Update index
    const indexFile = path.join(centralMem, 'index.json');
    let index = {};
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}
    index[process.cwd()] = branch;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    
    options.memDir = centralMem;
    options.memInfo = { memDir: centralMem, taskBranch: branch, projectDir: process.cwd(), isLocal: false };
    console.log(`${c.green}✓${c.reset} Created task: ${c.bold}${taskName}${c.reset}`);
    console.log(`${c.green}✓${c.reset} Mapped: ${c.dim}${process.cwd()} → ${branch}${c.reset}`);
    
    // Auto-set wake schedule 
    try {
      execSync(`mem wake "every 15m"`, { cwd: process.cwd(), stdio: 'ignore' });
    } catch {}
    
    // Start daemon for autonomous mode
    if (options.autonomous) {
      startDaemon();
      console.log(`${c.green}✓${c.reset} Autonomous mode: daemon will continue work every 15m\n`);
    }
    
  } catch (err) {
    console.error(`${c.yellow}Warning: Could not create task:${c.reset} ${err.message}`);
  }
}

// Prepend mem context to prompt if mem is enabled
if (options.mem && options.memInfo && finalPrompt) {
  const context = loadMemContext(options.memInfo);
  if (context) {
    const taskInfo = options.memInfo.taskBranch || 'local';
    console.log(`${c.dim}[mem] Loaded context: ${taskInfo} (${options.memInfo.projectDir})${c.reset}\n`);
    
    // Prepend context to prompt with full marker documentation
    const augmentedPrompt = `## Current Context (from mem)\n\n${context}\n\n## Task\n\n${finalPrompt}\n\n## Instructions\n\nYou are continuing work on this task. Review the context above, then continue where you left off.\n\n## Output Markers\n\nUse these markers to save state (will be parsed automatically):\n\n- [checkpoint: message] - save progress point\n- [learn: insight] - record a learning  \n- [next: step] - set what to work on next\n- [criteria: N] - mark criterion #N complete\n- [split: name "goal"] - break into subtask\n\nStopping markers (only use when needed):\n- [done] - task complete (all criteria met)\n- [blocked: reason] - need human help, cannot proceed\n- [approve: question] - need human approval before continuing\n\nThe default is to keep working. You will wake again in 15 minutes to continue.`;
    
    // Replace the prompt in translatedArgs
    const promptIndex = translatedArgs.indexOf(finalPrompt);
    if (promptIndex !== -1) {
      translatedArgs[promptIndex] = augmentedPrompt;
    }
  }
}

// Run with mem output capture or normal mode
if (options.mem && options.memDir) {
  // Capture output for marker parsing
  const child = spawn(command, translatedArgs, {
    env,
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: false
  });
  
  let output = '';
  
  child.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stdout.write(text);
  });
  
  child.on('exit', async (code) => {
    // Parse and apply mem markers
    const markers = parseMemMarkers(output);
    
    if (markers.length > 0) {
      console.log(`\n${c.dim}[mem] Processing markers...${c.reset}`);
      const result = applyMemMarkers(markers, options.memInfo || { memDir: options.memDir, projectDir: process.cwd() });
      
      // Create subtasks if any
      if (result.splits.length > 0) {
        createSubtasks(result.splits, options.memInfo || { memDir: options.memDir, projectDir: process.cwd() });
      }
      
      // Handle approvals
      if (result.approvals.length > 0) {
        const approved = await handleApprovals(result.approvals);
        if (!approved) {
          console.log(`${c.yellow}Workflow halted. Resume later.${c.reset}`);
          process.exit(1);
        }
      }
      
      // Handle loop control - default is CONTINUE (wake again in 15m)
      if (result.isDone) {
        console.log(`\n${c.green}✓ Task complete!${c.reset}`);
        // Clear wake schedule on done
        try {
          execSync('mem wake clear', { cwd: process.cwd(), stdio: 'ignore' });
          console.log(`${c.dim}Wake schedule cleared.${c.reset}`);
        } catch {}
        process.exit(0);
      } else if (result.isBlocked) {
        console.log(`\n${c.yellow}⚠ Task blocked. Human intervention needed.${c.reset}`);
        console.log(`${c.dim}Wake continues - run 'mem stuck clear' when unblocked.${c.reset}`);
        process.exit(1);
      } else if (options.untilDone) {
        // Local loop mode: wait and run again
        console.log(`\n${c.cyan}▶ Continuing in 10s...${c.reset}`);
        setTimeout(() => {
          const { spawnSync } = require('child_process');
          spawnSync(process.argv[0], process.argv.slice(1), { stdio: 'inherit' });
        }, 10000);
        return;
      } else {
        // Default: save and exit, wake will resume in 15m
        console.log(`\n${c.dim}Progress saved. Will continue on next wake (~15m).${c.reset}`);
      }
    }
    
    process.exit(code || 0);
  });
  
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`${c.red}Error:${c.reset} "${command}" command not found.`);
    } else {
      console.error(`${c.red}Failed to start ${command}:${c.reset}`, err.message);
    }
    process.exit(1);
  });
} else {
  // Normal mode - stdio inherit
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
      console.error(`${c.red}Error:${c.reset} "${command}" command not found.`);
      console.error(`\n${c.dim}Install it first:${c.reset}`);
      if (command === 'claude') {
        console.error(`  npm install -g @anthropic-ai/claude-code`);
      } else if (command === 'gemini') {
        console.error(`  npm install -g @anthropic-ai/gemini-cli`);
      }
    } else {
      console.error(`${c.red}Failed to start ${command}:${c.reset}`, err.message);
    }
    process.exit(1);
  });
}

})();

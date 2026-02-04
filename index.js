#!/usr/bin/env node

// ============================================================
// agx - AI Agent Task Orchestrator
//
// Architecture:
// - agx ORCHESTRATES tasks and AI agents (claude, gemini, ollama)
// - mem STORES data in ~/.mem git repo (pure KV primitives)
// - agx NEVER accesses ~/.mem directly - only via mem commands
// - This separation keeps agx focused on orchestration
//
// Data flow:
//   agx new "goal" -P claude
//     → mem new "goal" --provider claude --dir /project
//       → creates task/goal branch, writes files, commits
//
//   agx context --json
//     → reads via git show (parallel-safe, no checkout needed)
//     → returns {task, provider, goal, criteria, checkpoints...}
//
//   daemon runs tasks
//     → reads provider per task
//     → spawns: agx <provider> --continue <task>
// ============================================================

const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// agx skill - instructions for LLMs on how to use agx
const AGX_SKILL = `---
name: agx
description: Task orchestrator for AI agents. Uses mem primitives for persistence.
---

# agx - AI Agent Task Orchestrator

agx manages tasks and coordinates AI agents. Uses \`mem\` for persistence.

## Quick Start

\`\`\`bash
agx -a -p "Build a REST API"  # Autonomous: works until done
agx -p "explain this code"     # One-shot question
\`\`\`

## Task Lifecycle

\`\`\`bash
agx new "<goal>"               # Create task
agx new "<goal>" -P c          # Create with claude provider
agx new "<goal>" -P g --run    # Create with gemini and run immediately
agx context [task]             # Get task context (parallel-safe)
agx checkpoint "<msg>"         # Save progress
agx next "<step>"              # Set next step
agx criteria add "<text>"      # Add success criterion
agx criteria <n>               # Mark criterion #n complete
agx learn "<insight>"          # Record learning
agx done                       # Complete task
agx stuck "<reason>"           # Mark blocked
\`\`\`

## Checking Tasks

\`\`\`bash
agx status              # Current task
agx tasks               # All tasks (interactive browser)
agx tail [task]         # Live tail task log
agx daemon logs         # Recent daemon activity
\`\`\`

## Task Control

\`\`\`bash
agx run [task]          # Run task now
agx pause [task]        # Pause task (daemon won't run it)
agx resume [task]       # Resume task
agx stop [task]         # Mark done
agx delete [task]       # Delete task (alias: remove, rm)
agx nudge <task> "msg"  # Send steering message
\`\`\`

## Daemon

\`\`\`bash
agx daemon start        # Start background runner
agx daemon stop         # Stop daemon
agx daemon status       # Check if running
agx daemon logs         # Recent logs
\`\`\`

## Output Markers

When running agents, agx parses these markers:
\`\`\`
[checkpoint: message]   # Save progress
[learn: insight]        # Record learning
[next: step]            # Set next step
[criteria: N]           # Mark criterion #N complete
[done]                  # Task complete
[blocked: reason]       # Need human help
\`\`\`

## Providers

claude (c), gemini (g), ollama (o)

## Key Flags

-a  Autonomous mode (task + daemon + work until done)
-p  Prompt/goal
-y  Skip confirmations (implied by -a)
-P, --provider <c|g|o>  Provider for new task (claude/gemini/ollama)
-r, --run  Run task immediately after creating
--continue <task>  Continue existing task (used by daemon)
--json  Output JSON (for scripting)
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
// If exactOnly=true, only return exact directory matches (for new task creation)
function findMemDir(startDir = process.cwd(), exactOnly = false) {
  const HOME = process.env.HOME || process.env.USERPROFILE;
  const centralMem = path.join(HOME, '.mem');

  // First check local .mem in exact directory only
  const localMem = path.join(startDir, '.mem');
  if (localMem !== centralMem && fs.existsSync(localMem) && fs.existsSync(path.join(localMem, '.git'))) {
    return { memDir: localMem, taskBranch: null, projectDir: startDir, isLocal: true };
  }

  // Walk up for local .mem (unless exactOnly)
  if (!exactOnly) {
    let dir = path.dirname(startDir);
    while (dir !== path.dirname(dir)) {
      const memDir = path.join(dir, '.mem');
      if (memDir !== centralMem && fs.existsSync(memDir) && fs.existsSync(path.join(memDir, '.git'))) {
        return { memDir, taskBranch: null, projectDir: dir, isLocal: true };
      }
      dir = path.dirname(dir);
    }
  }

  // Then check ~/.mem with index
  const globalMem = centralMem;
  if (fs.existsSync(globalMem)) {
    const indexFile = path.join(globalMem, 'index.json');
    if (fs.existsSync(indexFile)) {
      try {
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        // Exact match
        if (index[startDir]) {
          return { memDir: globalMem, taskBranch: index[startDir], projectDir: startDir, isLocal: false };
        }
        // Check parent directories only if not exactOnly
        if (!exactOnly) {
          let checkDir = startDir;
          while (checkDir !== path.dirname(checkDir)) {
            checkDir = path.dirname(checkDir);
            if (index[checkDir]) {
              return { memDir: globalMem, taskBranch: index[checkDir], projectDir: checkDir, isLocal: false };
            }
          }
        }
      } catch {}
    }
  }

  return null;
}

// Read file from a branch without checkout (parallel-safe)
function gitShow(memDir, branch, filename) {
  try {
    return execSync(`git show ${branch}:${filename}`, {
      cwd: memDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

// Parse frontmatter from markdown content
function parseFrontmatter(content) {
  if (!content) return { frontmatter: {}, body: '' };

  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match) {
    const frontmatter = {};
    match[1].split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        frontmatter[key.trim()] = rest.join(':').trim();
      }
    });
    return { frontmatter, body: match[2].trim() };
  }
  return { frontmatter: {}, body: content };
}

// Build context data from a task branch WITHOUT checkout (parallel-safe)
// This is the critical fix for the parallel git checkout bug
// Returns structured data object
function getTaskContextData(memDir, branch) {
  const goalRaw = gitShow(memDir, branch, 'goal.md');
  const stateRaw = gitShow(memDir, branch, 'state.md');
  const memoryRaw = gitShow(memDir, branch, 'memory.md');
  const playbookRaw = gitShow(memDir, 'main', 'playbook.md');

  const taskName = branch.replace('task/', '');

  // Parse structured data
  let goalText = null;
  let criteria = [];
  let progress = 0;
  let nextStep = null;
  let status = 'active';
  let provider = 'claude';
  let checkpoints = [];
  let learnings = [];
  let playbookLearnings = [];

  if (goalRaw) {
    const { body } = parseFrontmatter(goalRaw);
    const goalMatch = body.match(/^#\s*Goal\s*\n+([^\n#]+)/m);
    goalText = goalMatch ? goalMatch[1].trim() : null;

    const criteriaSection = body.match(/## (?:Definition of Done|Criteria)\s*\n([\s\S]*?)(?=\n## |$)/);
    if (criteriaSection) {
      const lines = criteriaSection[1].trim().split('\n');
      lines.forEach((line, idx) => {
        if (line.match(/- \[[ x]\]/i)) {
          const done = /- \[x\]/i.test(line);
          const text = line.replace(/- \[[ x]\]\s*/i, '').trim();
          criteria.push({ index: idx + 1, done, text });
        }
      });
      const total = criteria.length;
      const checked = criteria.filter(c => c.done).length;
      progress = total > 0 ? Math.round((checked / total) * 100) : 0;
    }
  }

  if (stateRaw) {
    const { frontmatter, body } = parseFrontmatter(stateRaw);
    if (frontmatter.status) status = frontmatter.status;
    if (frontmatter.provider) provider = frontmatter.provider;

    const nextMatch = body.match(/## Next Step\s*\n+([^\n#]+)/);
    if (nextMatch) nextStep = nextMatch[1].trim();

    const checkpointsMatch = body.match(/## Checkpoints\s*\n([\s\S]*?)(?=\n## |$)/);
    if (checkpointsMatch) {
      checkpointsMatch[1].trim().split('\n').forEach(line => {
        if (line.startsWith('- [x]')) {
          checkpoints.push(line.replace(/- \[x\]\s*/, '').trim());
        }
      });
    }
  }

  if (memoryRaw) {
    memoryRaw.split('\n').forEach(line => {
      if (line.startsWith('- ')) {
        learnings.push(line.slice(2).trim());
      }
    });
  }

  if (playbookRaw) {
    playbookRaw.split('\n').forEach(line => {
      if (line.startsWith('- ')) {
        playbookLearnings.push(line.slice(2).trim());
      }
    });
  }

  return {
    task: taskName,
    branch,
    status,
    provider,
    goal: goalText,
    progress,
    criteria,
    nextStep,
    checkpoints: checkpoints.slice(-5),
    learnings: learnings.slice(-10),
    playbook: playbookLearnings.slice(-5)
  };
}

// Format task context data as human-readable text
function formatTaskContext(data) {
  let output = '';
  output += `─────────────────────────────────\n`;
  output += `${data.task}\n`;
  output += `─────────────────────────────────\n\n`;

  if (data.goal) {
    output += `Goal: ${data.goal}\n\n`;
  }

  if (data.criteria.length > 0) {
    const barWidth = 20;
    const filled = Math.round((data.progress / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    output += `Progress: ${bar} ${data.progress}% (${data.criteria.filter(c => c.done).length}/${data.criteria.length})\n\n`;
    output += `Criteria:\n`;
    data.criteria.forEach(c => {
      output += `  ${c.done ? '✓' : '○'} ${c.text}\n`;
    });
    output += '\n';
  }

  if (data.nextStep) {
    output += `Next: ${data.nextStep}\n\n`;
  }

  if (data.checkpoints.length > 0) {
    output += `Recent:\n`;
    data.checkpoints.slice(-3).forEach(cp => {
      output += `  • ${cp}\n`;
    });
    output += '\n';
  }

  if (data.learnings.length > 0) {
    output += `Learnings:\n`;
    data.learnings.slice(-5).forEach(l => {
      output += `  • ${l}\n`;
    });
    output += '\n';
  }

  if (data.playbook.length > 0) {
    output += `Playbook: ${data.playbook.length} global learnings\n`;
  }

  return output;
}

// Build context from a task branch WITHOUT checkout (parallel-safe)
// Returns formatted text string (for backwards compatibility)
function buildTaskContext(memDir, branch) {
  const data = getTaskContextData(memDir, branch);
  return formatTaskContext(data);
}

// Load mem context for a specific task (parallel-safe version)
function loadMemContext(memInfo) {
  try {
    if (memInfo.taskBranch && !memInfo.isLocal) {
      // Use git show instead of checkout - parallel safe!
      return buildTaskContext(memInfo.memDir, memInfo.taskBranch);
    }

    // For local .mem, fall back to mem CLI (single task anyway)
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
const DAEMON_STATE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'daemon-state.json');
const TASK_LOGS_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'logs');

// Get log file path for a task
function getTaskLogPath(taskName) {
  if (!fs.existsSync(TASK_LOGS_DIR)) {
    fs.mkdirSync(TASK_LOGS_DIR, { recursive: true });
  }
  return path.join(TASK_LOGS_DIR, `${taskName}.log`);
}

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
  console.log(`[${new Date().toISOString()}] Daemon starting (parallel mode)...`);

  const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
  const POLL_INTERVAL = 1000;
  const MAX_PARALLEL = 5; // Max concurrent tasks
  const runningTasks = new Set(); // Track running task branches

  function loadState() {
    try {
      if (fs.existsSync(DAEMON_STATE_FILE)) {
        return JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
      }
    } catch {}
    return { lastRun: {}, running: [] };
  }

  function saveState(state) {
    const dir = path.dirname(DAEMON_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    state.running = Array.from(runningTasks);
    fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));
  }

  // Get provider from task state (parallel-safe, no checkout)
  function getTaskProvider(taskBranch) {
    try {
      const stateRaw = execSync(`git show ${taskBranch}:state.md`, {
        cwd: memDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const match = stateRaw.match(/^provider:\s*(\w+)/m);
      return match ? match[1] : 'claude';
    } catch {
      return 'claude'; // Default fallback
    }
  }

  // Get active tasks (not done/blocked, not currently running)
  function getActiveTasks() {
    try {
      const out = execSync('mem tasks --json', { cwd: memDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const data = JSON.parse(out);
      const tasks = data.tasks || [];

      return tasks
        .filter(t => {
          if (!fs.existsSync(t.projectDir)) return false;
          if (runningTasks.has(t.branch)) return false; // Already running
          if (t.status === 'done' || t.status === 'blocked') return false;
          return true;
        })
        .map(t => ({
          taskName: t.taskName,
          taskBranch: t.branch,
          projectDir: t.projectDir,
          provider: getTaskProvider(t.branch)
        }));
    } catch {
      return [];
    }
  }

  // Run a single task iteration (returns promise)
  function runTask(task) {
    const { taskName, taskBranch, projectDir, provider } = task;
    const logPath = getTaskLogPath(taskName);

    console.log(`[${new Date().toISOString()}] Starting: ${taskName} (${provider})`);

    // Mark as running
    runningTasks.add(taskBranch);
    const state = loadState();
    state.lastRun[taskBranch] = Date.now();
    saveState(state);

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n=== ${new Date().toISOString()} [${provider}] ===\n`);

    return new Promise((resolve) => {
      // Use --continue to load task context, with task's provider
      const child = spawn('agx', [provider, '--continue', taskName], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        logStream.write(data);
      });
      child.stderr.on('data', (data) => {
        logStream.write(data);
      });

      const timeout = setTimeout(() => {
        child.kill();
        logStream.write(`\nTIMEOUT: Killed after 30 minutes\n`);
      }, 30 * 60 * 1000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        logStream.end();
        runningTasks.delete(taskBranch);
        saveState(loadState());
        console.log(`[${new Date().toISOString()}] Finished: ${taskName} (code ${code})`);
        resolve(code);
      });

      child.on('error', (err) => {
        logStream.write(`\nERROR: ${err.message}\n`);
        logStream.end();
        runningTasks.delete(taskBranch);
        saveState(loadState());
        console.log(`[${new Date().toISOString()}] Error: ${taskName} - ${err.message}`);
        resolve(1);
      });
    });
  }

  // Main loop
  console.log(`[${new Date().toISOString()}] Daemon running, max ${MAX_PARALLEL} parallel tasks`);

  while (true) {
    const activeTasks = getActiveTasks();
    const availableSlots = MAX_PARALLEL - runningTasks.size;

    if (activeTasks.length > 0 && availableSlots > 0) {
      // Start tasks up to available slots (don't await - run in parallel)
      const toStart = activeTasks.slice(0, availableSlots);
      for (const task of toStart) {
        runTask(task); // Fire and forget
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
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

// ==================== INTERACTIVE MENU ====================

// Run interactive menu when agx is invoked with no arguments
async function runInteractiveMenu() {
  const providers = detectProviders();
  const config = loadConfig();

  const clearScreen = () => process.stdout.write('\x1b[2J\x1b[H');
  const hideCursor = () => process.stdout.write('\x1b[?25l');
  const showCursor = () => process.stdout.write('\x1b[?25h');

  // Menu state
  let menuState = 'main'; // 'main', 'action', 'tasks', 'daemon'
  let selectedIdx = 0;
  let selectedProvider = null;

  // Build main menu items
  const buildMainMenu = () => {
    const items = [];

    // Add available providers
    if (providers.claude) {
      items.push({ id: 'claude', label: 'claude', desc: 'Anthropic Claude Code', type: 'provider' });
    }
    if (providers.gemini) {
      items.push({ id: 'gemini', label: 'gemini', desc: 'Google Gemini', type: 'provider' });
    }
    if (providers.ollama) {
      items.push({ id: 'ollama', label: 'ollama', desc: 'Local Ollama', type: 'provider' });
    }

    // Separator and other options
    items.push({ id: 'sep1', type: 'separator' });

    // Load tasks to show count
    let taskCount = 0;
    try {
      const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
      if (fs.existsSync(memDir)) {
        const out = execSync('mem tasks --json', { cwd: memDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const data = JSON.parse(out);
        taskCount = (data.tasks || []).filter(t => t.status !== 'done').length;
      }
    } catch {}

    const taskLabel = taskCount > 0 ? `Manage Tasks (${taskCount} active)` : 'Manage Tasks';
    items.push({ id: 'tasks', label: taskLabel, desc: 'View and continue tasks', type: 'action' });
    items.push({ id: 'daemon', label: 'Daemon', desc: 'Background task runner', type: 'action' });

    return items;
  };

  // Build action menu (after selecting provider)
  const buildActionMenu = () => [
    { id: 'chat', label: 'Chat', desc: 'Start interactive conversation', type: 'action' },
    { id: 'newtask', label: 'New Task', desc: 'Create autonomous task', type: 'action' },
    { id: 'sep', type: 'separator' },
    { id: 'back', label: '← Back', desc: '', type: 'back' },
  ];

  // Build daemon menu
  const buildDaemonMenu = () => {
    const pid = isDaemonRunning();
    const items = [];
    if (pid) {
      items.push({ id: 'stop', label: 'Stop', desc: `Stop daemon (pid ${pid})`, type: 'action' });
    } else {
      items.push({ id: 'start', label: 'Start', desc: 'Start background daemon', type: 'action' });
    }
    items.push({ id: 'status', label: 'Status', desc: 'Check daemon status', type: 'action' });
    items.push({ id: 'logs', label: 'Logs', desc: 'Show recent logs', type: 'action' });
    items.push({ id: 'sep', type: 'separator' });
    items.push({ id: 'back', label: '← Back', desc: '', type: 'back' });
    return items;
  };

  // Get current menu items
  const getMenuItems = () => {
    switch (menuState) {
      case 'main': return buildMainMenu();
      case 'action': return buildActionMenu();
      case 'daemon': return buildDaemonMenu();
      default: return buildMainMenu();
    }
  };

  // Render the menu (flicker-free by overwriting in place)
  const render = () => {
    const items = getMenuItems();
    const clearLine = '\x1b[K'; // Clear from cursor to end of line
    const home = '\x1b[H';      // Move cursor to home (1,1)
    const clearBelow = '\x1b[J'; // Clear from cursor to end of screen

    // Build output buffer
    const lines = [];

    // Header
    if (menuState === 'main') {
      lines.push(`${c.bold}${c.cyan}agx${c.reset}  ${c.dim}Autonomous AI Agents${c.reset}`);
    } else if (menuState === 'action' && selectedProvider) {
      lines.push(`${c.bold}${c.cyan}agx${c.reset} ${c.dim}›${c.reset} ${c.bold}${selectedProvider}${c.reset}`);
    } else if (menuState === 'daemon') {
      lines.push(`${c.bold}${c.cyan}agx${c.reset} ${c.dim}›${c.reset} ${c.bold}Daemon${c.reset}`);
    }
    lines.push(''); // blank line after header

    // Menu items
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

    // Footer with keybindings
    lines.push('');
    if (menuState === 'main') {
      lines.push(`${c.dim}↑/↓ select · enter choose · q quit${c.reset}`);
    } else {
      lines.push(`${c.dim}↑/↓ select · enter choose · esc back · q quit${c.reset}`);
    }

    // Write all at once: move home, draw each line with clear-to-EOL, then clear below
    process.stdout.write(home + lines.map(l => l + clearLine).join('\n') + clearBelow);
  };

  // Release TTY before spawning child processes
  const releaseTTY = () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    showCursor();
    clearScreen();
  };

  // Handle selection
  const handleSelect = async () => {
    const items = getMenuItems();
    const item = items[selectedIdx];

    if (!item || item.type === 'separator') return;

    // Handle back option
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
      } else if (item.id === 'tasks') {
        // Launch tasks browser
        releaseTTY();
        const child = spawn(process.argv[0], [process.argv[1], 'tasks'], { stdio: 'inherit' });
        child.on('close', () => process.exit(0));
        return;
      } else if (item.id === 'daemon') {
        menuState = 'daemon';
        selectedIdx = 0;
        render();
      }
    } else if (menuState === 'action') {
      releaseTTY();

      if (item.id === 'chat') {
        // Launch provider in interactive mode
        let cmd, args;
        if (selectedProvider === 'ollama') {
          cmd = 'claude';
          args = ['--model', 'glm-4.7:cloud'];
          const env = {
            ...process.env,
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            ANTHROPIC_BASE_URL: 'http://localhost:11434',
            ANTHROPIC_API_KEY: 'none'
          };
          const child = spawn(cmd, args, { stdio: 'inherit', env });
          child.on('close', (code) => process.exit(code || 0));
        } else {
          cmd = selectedProvider;
          args = [];
          const child = spawn(cmd, args, { stdio: 'inherit' });
          child.on('close', (code) => process.exit(code || 0));
        }
        return;
      } else if (item.id === 'newtask') {
        // Prompt for goal
        console.log(`${c.bold}New Task${c.reset} ${c.dim}(${selectedProvider})${c.reset}\n`);
        const goal = await prompt(`${c.cyan}Goal:${c.reset} `);
        if (!goal.trim()) {
          console.log(`${c.yellow}Cancelled${c.reset}`);
          process.exit(0);
        }
        console.log('');
        // Run agx <provider> -a -p "<goal>"
        const child = spawn(process.argv[0], [process.argv[1], selectedProvider, '-a', '-p', goal], { stdio: 'inherit' });
        child.on('close', (code) => process.exit(code || 0));
        return;
      }
    } else if (menuState === 'daemon') {
      showCursor();
      clearScreen();

      if (item.id === 'start') {
        startDaemon();
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        render();
        return;
      } else if (item.id === 'stop') {
        stopDaemon();
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        selectedIdx = 0; // Reset since menu will change
        render();
        return;
      } else if (item.id === 'status') {
        const pid = isDaemonRunning();
        if (pid) {
          console.log(`${c.green}Daemon running${c.reset} (pid ${pid})`);
          console.log(`${c.dim}Logs: ${DAEMON_LOG_FILE}${c.reset}`);
        } else {
          console.log(`${c.yellow}Daemon not running${c.reset}`);
        }
        console.log('');
        await prompt(`${c.dim}Press Enter to continue...${c.reset}`);
        hideCursor();
        render();
        return;
      } else if (item.id === 'logs') {
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

  // Handle back navigation
  const handleBack = () => {
    if (menuState === 'action' || menuState === 'daemon') {
      menuState = 'main';
      selectedIdx = 0;
      render();
    }
  };

  // Ensure proper cleanup on exit
  const cleanup = () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    showCursor();
    clearScreen();
    process.exit(0);
  };

  // Non-TTY fallback: numbered menu
  if (!process.stdin.isTTY) {
    const items = buildMainMenu().filter(i => i.type !== 'separator');
    console.log(`${c.bold}${c.cyan}agx${c.reset}  ${c.dim}Autonomous AI Agents${c.reset}\n`);
    items.forEach((item, idx) => {
      console.log(`  ${c.cyan}${idx + 1}${c.reset}) ${item.label}  ${c.dim}${item.desc}${c.reset}`);
    });
    console.log(`  ${c.cyan}q${c.reset}) Quit\n`);

    const choice = await prompt('Choice: ');
    if (choice === 'q' || choice === 'Q') {
      process.exit(0);
    }

    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < items.length) {
      const item = items[idx];
      if (item.type === 'provider') {
        console.log(`\n${c.bold}${item.label}${c.reset}\n`);
        console.log(`  ${c.cyan}1${c.reset}) Chat`);
        console.log(`  ${c.cyan}2${c.reset}) New Task`);
        console.log(`  ${c.cyan}0${c.reset}) Back\n`);
        const actionChoice = await prompt('Choice: ');
        if (actionChoice === '0') {
          // Back - re-run menu
          spawn(process.argv[0], [process.argv[1]], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          return;
        } else if (actionChoice === '1') {
          let cmd = item.id;
          if (item.id === 'ollama') {
            const env = { ...process.env, ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_API_KEY: 'none' };
            spawn('claude', ['--model', 'glm-4.7:cloud'], { stdio: 'inherit', env }).on('close', (code) => process.exit(code || 0));
          } else {
            spawn(cmd, [], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          }
        } else if (actionChoice === '2') {
          const goal = await prompt('Goal: ');
          if (goal.trim()) {
            spawn(process.argv[0], [process.argv[1], item.id, '-a', '-p', goal], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          }
        }
      } else if (item.id === 'tasks') {
        spawn(process.argv[0], [process.argv[1], 'tasks'], { stdio: 'inherit' }).on('close', () => process.exit(0));
      } else if (item.id === 'daemon') {
        console.log(`\n${c.bold}Daemon${c.reset}\n`);
        const pid = isDaemonRunning();
        if (pid) {
          console.log(`  ${c.cyan}1${c.reset}) Stop`);
        } else {
          console.log(`  ${c.cyan}1${c.reset}) Start`);
        }
        console.log(`  ${c.cyan}2${c.reset}) Status`);
        console.log(`  ${c.cyan}3${c.reset}) Logs`);
        console.log(`  ${c.cyan}0${c.reset}) Back\n`);
        const dChoice = await prompt('Choice: ');
        if (dChoice === '0') {
          // Back - re-run menu
          spawn(process.argv[0], [process.argv[1]], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          return;
        } else if (dChoice === '1') {
          if (pid) stopDaemon(); else startDaemon();
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

  // TTY mode: interactive keyboard navigation
  process.stdin.setRawMode(true);
  process.stdin.resume();
  hideCursor();
  render();

  // Handle keyboard input
  process.stdin.on('data', async (key) => {
    const k = key.toString();
    const items = getMenuItems();

    // Find next valid index (skip separators)
    const findValidUp = (from) => {
      let idx = from - 1;
      while (idx >= 0 && items[idx]?.type === 'separator') idx--;
      return idx >= 0 ? idx : from; // Stay in place if no valid item above
    };

    const findValidDown = (from) => {
      let idx = from + 1;
      while (idx < items.length && items[idx]?.type === 'separator') idx++;
      return idx < items.length ? idx : from; // Stay in place if no valid item below
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

// Check for commands or first run
async function checkOnboarding() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Bare invocation: no args → interactive menu
  if (args.length === 0) {
    const config = loadConfig();
    // Only show interactive menu if configured (has run init)
    if (config) {
      await runInteractiveMenu();
      return true;
    }
    // Fall through to first run detection below
  }

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

  // Status command - show task status if in project, else config
  if (cmd === 'status') {
    // Check if we're in a task project
    const memInfo = findMemDir();
    if (memInfo && memInfo.taskBranch) {
      try {
        execSync('mem status', { stdio: 'inherit' });
        process.exit(0);
      } catch {}
    }
    // Fall back to config status
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

  // ============================================================
  // AGX TASK COMMANDS
  //
  // Architecture:
  // - agx is the task ORCHESTRATOR - it coordinates AI agents
  // - mem is the STORAGE layer - git-backed KV store
  // - agx NEVER accesses ~/.mem directly - only via mem commands
  // - This separation allows mem to change storage backend later
  // ============================================================

  // Provider aliases for convenience
  const PROVIDER_ALIASES = {
    'c': 'claude', 'cl': 'claude', 'claude': 'claude',
    'g': 'gemini', 'gem': 'gemini', 'gemini': 'gemini',
    'o': 'ollama', 'ol': 'ollama', 'ollama': 'ollama'
  };

  // ============================================================
  // agx new "<goal>" [--provider c|g|o] [--run] [--json]
  // Creates a new task via mem, optionally runs it immediately
  // ============================================================
  if (cmd === 'new') {
    const jsonMode = args.includes('--json');
    const runAfter = args.includes('--run') || args.includes('-r');

    // Parse --provider / -P flag and resolve alias
    let provider = null;
    const providerIdx = args.findIndex(a => a === '--provider' || a === '-P');
    if (providerIdx !== -1 && args[providerIdx + 1]) {
      const alias = args[providerIdx + 1].toLowerCase();
      provider = PROVIDER_ALIASES[alias];
      if (!provider) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'invalid_provider', provider: alias }));
        } else {
          console.log(`${c.red}Invalid provider:${c.reset} ${alias}`);
          console.log(`${c.dim}Valid: c/claude, g/gemini, o/ollama${c.reset}`);
        }
        process.exit(1);
      }
    }

    // Default provider from config
    if (!provider) {
      const config = loadConfig();
      provider = config?.defaultProvider || 'claude';
    }

    // Extract goal text (filter out flags)
    const flagsToRemove = ['--json', '--run', '-r', '--provider', '-P'];
    const goalParts = [];
    for (let i = 1; i < args.length; i++) {
      if (flagsToRemove.includes(args[i])) {
        if (args[i] === '--provider' || args[i] === '-P') i++;
        continue;
      }
      goalParts.push(args[i]);
    }
    const goalText = goalParts.join(' ');

    if (!goalText) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'missing_goal', usage: 'agx new "<goal>" [--provider c] [--run]' }));
      } else {
        console.log(`${c.red}Usage:${c.reset} agx new "<goal>" [--provider c|g|o] [--run]`);
      }
      process.exit(1);
    }

    const projectDir = process.cwd();

    try {
      // Use mem to create the task - agx never touches ~/.mem directly
      // mem new handles: branch creation, file setup, index mapping, commit
      const memArgs = [
        'new',
        goalText,
        '--provider', provider,
        '--dir', projectDir
      ];
      if (jsonMode) memArgs.push('--json');

      const result = execSync(`mem ${memArgs.map(a => `"${a}"`).join(' ')}`, {
        cwd: projectDir,
        encoding: 'utf8'
      });

      // Pass through mem's output (includes JSON if --json)
      if (!runAfter || !jsonMode) {
        process.stdout.write(result);
      }

      // Run if requested
      if (runAfter) {
        // Parse task name from mem's JSON output
        let taskName;
        if (jsonMode) {
          const parsed = JSON.parse(result.trim());
          taskName = parsed.taskName;
        } else {
          // Extract from "Created task: taskname" line
          const match = result.match(/Created task:\s*\x1b\[1m(\S+)/);
          taskName = match ? match[1] : goalText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 3).join('-');
        }

        if (!jsonMode) {
          console.log(`${c.cyan}▶${c.reset} Running task...`);
        }

        // Spawn agx with the provider
        const child = spawn(process.argv[0], [process.argv[1], provider, '--continue', taskName, '-y'], {
          cwd: projectDir,
          stdio: jsonMode ? 'pipe' : 'inherit'
        });
        child.on('close', (code) => process.exit(code || 0));
        return true;
      }
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx context [task] [--json] - Get task context (parallel-safe, no checkout)
  if (cmd === 'context') {
    const jsonMode = args.includes('--json');
    const taskArg = args.slice(1).find(a => a !== '--json');
    const centralMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');

    if (!fs.existsSync(centralMem)) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'no_mem_repo' }));
      } else {
        console.log(`${c.yellow}No .mem repo found.${c.reset} Run ${c.cyan}agx new "<goal>"${c.reset} first.`);
      }
      process.exit(1);
    }

    let branch = null;

    if (taskArg) {
      // Specific task requested
      branch = taskArg.startsWith('task/') ? taskArg : `task/${taskArg}`;
      try {
        execSync(`git show-ref --verify refs/heads/${branch}`, { cwd: centralMem, stdio: 'ignore' });
      } catch {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'task_not_found', task: taskArg }));
        } else {
          console.log(`${c.red}Task not found:${c.reset} ${taskArg}`);
        }
        process.exit(1);
      }
    } else {
      // Try to find task for current directory
      if (fs.existsSync(indexFile)) {
        try {
          const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
          branch = index[process.cwd()];
        } catch {}
      }
      if (!branch) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'no_task_mapped', cwd: process.cwd() }));
        } else {
          console.log(`${c.yellow}No task mapped for this directory.${c.reset}`);
          console.log(`${c.dim}Run ${c.reset}agx new "<goal>"${c.dim} to create one.${c.reset}`);
        }
        process.exit(1);
      }
    }

    // Use parallel-safe context building (no checkout!)
    const data = getTaskContextData(centralMem, branch);

    if (jsonMode) {
      console.log(JSON.stringify(data));
    } else {
      console.log(formatTaskContext(data));
    }
    process.exit(0);
  }

  // ==================== MEM PASSTHROUGH COMMANDS ====================
  // These wrap mem CLI so users only need agx (will be migrated over time)

  const memPassthroughCommands = {
    'init': true,      // agx init <name> "<goal>" → mem init
    'done': true,      // agx done → mem done
    'stuck': true,     // agx stuck [reason|clear] → mem stuck
    'switch': true,    // agx switch <name> → mem switch
    'checkpoint': true,// agx checkpoint "<msg>" → mem checkpoint
    'learn': true,     // agx learn "<insight>" → mem learn
    'next': true,      // agx next "<step>" → mem next
    'progress': true,  // agx progress → mem progress
    'criteria': true,  // agx criteria [add|N] → mem criteria
    'goal': true,      // agx goal [value] → mem goal
    'learnings': true, // agx learnings → mem learnings
    'playbook': true,  // agx playbook → mem playbook
  };

  if (memPassthroughCommands[cmd]) {
    // Pass through to mem with all remaining args
    const memArgs = args.slice(1).map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    const memCmd = `mem ${cmd} ${memArgs}`.trim();

    try {
      execSync(memCmd, { stdio: 'inherit' });
    } catch (err) {
      // mem already printed error
      process.exit(err.status || 1);
    }
    process.exit(0);
  }
  
  // ==================== TASK MANAGEMENT ====================

  // Helper: load all tasks with their info using mem CLI
  function loadTasks() {
    let state = {};
    try {
      if (fs.existsSync(DAEMON_STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
      }
    } catch {}

    // Get tasks from mem CLI (uses central .mem)
    let memTasks = [];
    try {
      const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
      const out = execSync('mem tasks --json', { cwd: memDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const data = JSON.parse(out);
      memTasks = data.tasks || [];
    } catch {
      return [];
    }

    const tasks = memTasks.map(mt => {
      const taskBranch = mt.branch;
      const taskName = mt.taskName;
      const projectDir = mt.projectDir;
      let status = mt.status || 'active';
      let progress = mt.progress || '—';
      let criteria = mt.criteria || [];
      let lastRun = '—';

      // Override status if running
      if (state.running === taskBranch) {
        status = 'running';
      }

      // Calculate lastRun from daemon state
      if (state.lastRun && state.lastRun[taskBranch]) {
        const lastMs = state.lastRun[taskBranch];
        const ago = Date.now() - lastMs;
        lastRun = `${Math.round(ago / 60000)}m ago`;
      }

      return { taskName, taskBranch, projectDir, status, lastRun, progress, criteria };
    });

    return tasks;
  }

  // Helper: find task by name (partial match)
  function findTask(tasks, name) {
    if (!name) return null;
    return tasks.find(t => t.taskName === name) ||
           tasks.find(t => t.taskName.includes(name)) ||
           tasks.find(t => t.taskBranch.includes(name));
  }

  // Helper: get task logs from per-task log file
  function getTaskLogs(task, limit = 20) {
    const logPath = getTaskLogPath(task.taskName);
    if (!fs.existsSync(logPath)) return [];
    try {
      const logs = fs.readFileSync(logPath, 'utf8');
      return logs.split('\n').slice(-limit);
    } catch { return []; }
  }

  // ==================== NUDGE ====================
  // Nudge: send a steering message to an agent for its next run
  // Uses mem KV primitives: stores in state.md frontmatter as 'nudges' key
  // Format: JSON array of messages, popped on context load by agx

  if (cmd === 'nudge' || cmd === 'steer') {
    const taskArg = args[1];
    const message = args.slice(2).join(' ');

    if (!taskArg) {
      console.log(`${c.red}Usage:${c.reset} agx nudge <task> "message"`);
      console.log(`${c.dim}Example: agx nudge mesh-cli "focus on API first"${c.reset}`);
      process.exit(1);
    }

    const tasks = loadTasks();
    const task = findTask(tasks, taskArg);

    if (!task) {
      console.log(`${c.yellow}Task not found: ${taskArg}${c.reset}`);
      console.log(`${c.dim}Available: ${tasks.map(t => t.taskName).join(', ')}${c.reset}`);
      process.exit(1);
    }

    // No message = show current nudges
    if (!message) {
      try {
        const out = execSync(`mem get nudges`, { cwd: task.projectDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (out.includes('Not set') || !out.trim()) {
          console.log(`${c.dim}No pending nudges for ${task.taskName}${c.reset}`);
        } else {
          const nudges = JSON.parse(out.trim());
          console.log(`${c.bold}Pending nudges for ${task.taskName}:${c.reset}\n`);
          nudges.forEach(n => console.log(`  ${c.yellow}→${c.reset} ${n}`));
        }
      } catch {
        console.log(`${c.dim}No pending nudges for ${task.taskName}${c.reset}`);
      }
      process.exit(0);
    }

    // Add nudge to the list
    let nudges = [];
    try {
      const out = execSync(`mem get nudges`, { cwd: task.projectDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (!out.includes('Not set') && out.trim()) {
        nudges = JSON.parse(out.trim());
      }
    } catch {}

    const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    nudges.push(`[${timestamp}] ${message}`);

    try {
      // Use spawnSync to avoid shell quoting issues with quotes in messages
      const result = spawnSync('mem', ['set', 'nudges', JSON.stringify(nudges)], {
        cwd: task.projectDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || 'Failed to save nudge');
      }
      console.log(`${c.green}✓${c.reset} Nudge added to ${c.bold}${task.taskName}${c.reset}`);
      console.log(`${c.dim}Will be shown on next agent run${c.reset}`);
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // Tail task log
  if (cmd === 'tail') {
    const tasks = loadTasks();
    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : null;

    // If no arg, try current directory
    if (!task && !taskArg) {
      const cwd = process.cwd();
      task = tasks.find(t => t.projectDir === cwd);
    }

    if (!task) {
      if (tasks.length === 0) {
        console.log(`${c.yellow}No tasks found${c.reset}`);
      } else {
        console.log(`${c.yellow}Task not found${c.reset}${taskArg ? `: ${taskArg}` : ''}`);
        console.log(`${c.dim}Available: ${tasks.map(t => t.taskName).join(', ')}${c.reset}`);
      }
      process.exit(1);
    }

    const logPath = getTaskLogPath(task.taskName);
    if (!fs.existsSync(logPath)) {
      console.log(`${c.dim}No logs yet for ${task.taskName}${c.reset}`);
      console.log(`${c.dim}Log file: ${logPath}${c.reset}`);
      process.exit(0);
    }

    console.log(`${c.dim}Tailing ${task.taskName} → ${logPath}${c.reset}\n`);

    // Use spawn to tail -f the log file
    const tail = spawn('tail', ['-f', logPath], {
      stdio: ['ignore', 'inherit', 'inherit']
    });

    tail.on('error', (err) => {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
      process.exit(1);
    });

    // Handle ctrl-c gracefully
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });

    return true;
  }

  // Run task immediately
  if (cmd === 'run') {
    const tasks = loadTasks();
    if (tasks.length === 0) {
      console.log(`${c.yellow}No tasks found${c.reset}`);
      process.exit(1);
    }

    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : null;

    // If no arg, try current directory
    if (!task && !taskArg) {
      const cwd = process.cwd();
      task = tasks.find(t => t.projectDir === cwd);
    }

    if (!task) {
      console.log(`${c.yellow}Task not found${c.reset}${taskArg ? `: ${taskArg}` : ''}`);
      console.log(`${c.dim}Available: ${tasks.map(t => t.taskName).join(', ')}${c.reset}`);
      process.exit(1);
    }

    console.log(`${c.cyan}▶${c.reset} Running ${c.bold}${task.taskName}${c.reset}...\n`);

    // Mark as running
    let state = {};
    try {
      if (fs.existsSync(DAEMON_STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
      }
    } catch {}
    state.running = task.taskBranch;
    const agxDir = path.dirname(DAEMON_STATE_FILE);
    if (!fs.existsSync(agxDir)) fs.mkdirSync(agxDir, { recursive: true });
    fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));

    // Setup log file
    const logPath = getTaskLogPath(task.taskName);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n--- ${new Date().toISOString()} ---\n`);

    // Build task context prompt
    const centralMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
    const contextData = getTaskContextData(centralMem, task.taskBranch);

    // Pop nudges from mem (read and clear)
    let nudges = [];
    try {
      const nudgesOut = execSync(`mem pop nudges --json`, {
        cwd: task.projectDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const { value } = JSON.parse(nudgesOut);
      if (value) {
        nudges = JSON.parse(value);
        if (nudges.length > 0) {
          console.log(`${c.yellow}📬 Nudges from user:${c.reset}`);
          nudges.forEach(n => console.log(`  ${c.yellow}→${c.reset} ${n}`));
          console.log('');
        }
      }
    } catch {}

    let prompt = `═══════════════════════════════════════════════════════════════════
                    AUTONOMOUS AGENT SESSION
═══════════════════════════════════════════════════════════════════

You are waking up to continue a task. You have NO MEMORY of previous sessions.
Your only continuity is what's stored in mem. Read it carefully.

TASK: ${task.taskName}
GOAL: ${contextData.goalText || 'NOT SET - Define this first!'}
`;

    if (contextData.criteria && contextData.criteria.length > 0) {
      prompt += `\nPROGRESS: ${contextData.progress}% (${contextData.criteria.filter(c => c.done).length}/${contextData.criteria.length} criteria)\n`;
      prompt += `CRITERIA:\n`;
      contextData.criteria.forEach(c => {
        prompt += `  ${c.done ? '✓' : '○'} ${c.text}\n`;
      });
    } else {
      prompt += `\nCRITERIA: None defined - You must define success criteria first!\n`;
    }

    if (contextData.nextStep) {
      prompt += `\nNEXT STEP (from last session): ${contextData.nextStep}\n`;
    }

    if (contextData.checkpoints && contextData.checkpoints.length > 0) {
      prompt += `\nRECENT PROGRESS:\n`;
      contextData.checkpoints.slice(-5).forEach(cp => {
        prompt += `  • ${cp}\n`;
      });
    }

    if (contextData.learnings && contextData.learnings.length > 0) {
      prompt += `\nLEARNINGS:\n`;
      contextData.learnings.slice(-3).forEach(l => {
        prompt += `  • ${l}\n`;
      });
    }

    prompt += `
═══════════════════════════════════════════════════════════════════
                         WAKE-WORK-SLEEP CYCLE
═══════════════════════════════════════════════════════════════════

Your workflow for autonomous operation:

┌─────────────────────────────────────────────────────────────────┐
│ 1. ORIENT (you are here)                                        │
│    • Read your state above - this is all you know               │
│    • Run: mem context   (for full context if needed)            │
│    • Run: mem history   (to see progression)                    │
│    • Run: mem playbook  (for global strategies)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. PLAN                                                         │
│    If no criteria defined:                                      │
│      mem criteria add "<criterion>"  (define success)           │
│      mem constraint add "<rule>"     (define boundaries)        │
│    Set your intent:                                             │
│      mem next "<what you'll do>"                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. EXECUTE                                                      │
│    Do the work. Make progress toward criteria.                  │
│    Save discoveries:                                            │
│      mem learn "<insight>"       (task-specific)                │
│      mem learn -g "<insight>"    (global - all tasks)           │
│      mem promote <n>             (promote to playbook)          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. CHECKPOINT (before session ends or after milestones)         │
│    mem checkpoint "<what you accomplished>"                     │
│    mem criteria <n>              (mark criterion done)          │
│    mem next "<what comes next>"  (for next wake cycle)          │
│    mem progress                  (verify progress %)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. ADAPT                                                        │
│    If blocked:  mem stuck "<reason>"                            │
│    If unblocked: mem stuck clear                                │
│    If done:     mem done                                        │
│    If lost:     ASK THE USER                                    │
└─────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════
                           KEY PRINCIPLES
═══════════════════════════════════════════════════════════════════

• MEMORY IS EVERYTHING - You forget between sessions. Save state.
• CRITERIA DRIVE COMPLETION - No criteria = no way to know when done
• CHECKPOINT OFTEN - Don't lose progress to session death
• ASK WHEN STUCK - Don't spin. Get a nudge from the user.
• LEARN & PROMOTE - Build the playbook for future tasks

═══════════════════════════════════════════════════════════════════
`;

    // Add nudges section if any
    if (nudges.length > 0) {
      prompt += `
═══════════════════════════════════════════════════════════════════
                        📬 NUDGES FROM USER
═══════════════════════════════════════════════════════════════════

The user left these steering messages for you:

${nudges.map(n => `  → ${n}`).join('\n')}

**IMPORTANT:** Address these nudges in your work. They are guidance
from the user about what to focus on or how to proceed.

═══════════════════════════════════════════════════════════════════
`;
    }

    prompt += `\nBEGIN: Orient yourself, then continue toward the goal.`;

    const child = spawn('agx', ['claude', '-y', '-p', prompt], {
      cwd: task.projectDir,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      logStream.write(data);
      process.stdout.write(data);
    });
    child.stderr.on('data', (data) => {
      logStream.write(data);
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      logStream.end();
      // Clear running state
      try {
        state = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
        delete state.running;
        fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));
      } catch {}
      process.exit(code || 0);
    });

    child.on('error', (err) => {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
      logStream.end();
      process.exit(1);
    });

    return true; // Don't continue execution
  }

  // Pause task
  if (cmd === 'pause') {
    const tasks = loadTasks();
    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : tasks.find(t => t.projectDir === process.cwd());

    if (!task) {
      console.log(`${c.yellow}Task not found${c.reset}`);
      process.exit(1);
    }

    try {
      // Set status to paused - daemon won't run paused tasks
      execSync('mem set status paused', { cwd: task.projectDir, stdio: 'ignore' });
      console.log(`${c.yellow}⏸${c.reset} Paused ${c.bold}${task.taskName}${c.reset}`);
      console.log(`${c.dim}Resume with: agx resume ${task.taskName}${c.reset}`);
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // Resume task (set status back to active)
  if (cmd === 'resume') {
    const tasks = loadTasks();
    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : tasks.find(t => t.projectDir === process.cwd());

    if (!task) {
      console.log(`${c.yellow}Task not found${c.reset}`);
      process.exit(1);
    }

    try {
      // Set status to active - daemon will run it immediately
      execSync('mem set status active', { cwd: task.projectDir, stdio: 'ignore' });
      console.log(`${c.green}▶${c.reset} Resumed ${c.bold}${task.taskName}${c.reset}`);
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // Stop task (mark done)
  if (cmd === 'stop') {
    const tasks = loadTasks();
    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : tasks.find(t => t.projectDir === process.cwd());

    if (!task) {
      console.log(`${c.yellow}Task not found${c.reset}`);
      process.exit(1);
    }

    try {
      // Set status to done - daemon won't run done tasks
      execSync('mem set status done', { cwd: task.projectDir, stdio: 'ignore' });
      console.log(`${c.green}✓${c.reset} Stopped ${c.bold}${task.taskName}${c.reset} (marked done)`);
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // Remove/delete task
  if (cmd === 'remove' || cmd === 'rm' || cmd === 'delete') {
    const tasks = loadTasks();
    const taskArg = args[1];
    let task = taskArg ? findTask(tasks, taskArg) : null;

    if (!task) {
      console.log(`${c.yellow}Task not found: ${taskArg || '(none)'}${c.reset}`);
      console.log(`${c.dim}Available: ${tasks.map(t => t.taskName).join(', ')}${c.reset}`);
      process.exit(1);
    }

    try {
      const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
      const branchName = task.taskBranch || `task/${task.taskName}`;

      // Delete the git branch
      execSync(`git branch -D "${branchName}"`, { cwd: memDir, stdio: 'ignore' });

      // Remove from index.json if present
      const indexFile = path.join(memDir, 'index.json');
      if (fs.existsSync(indexFile)) {
        try {
          const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
          let changed = false;
          for (const [dir, branch] of Object.entries(index)) {
            if (branch === branchName) {
              delete index[dir];
              changed = true;
            }
          }
          if (changed) {
            fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
          }
        } catch {}
      }

      console.log(`${c.red}✗${c.reset} Deleted ${c.bold}${task.taskName}${c.reset}`);
    } catch (err) {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // Interactive tasks browser
  if (cmd === 'tasks') {
    const tasks = loadTasks();

    if (tasks.length === 0) {
      console.log(`${c.yellow}No tasks found${c.reset}`);
      process.exit(0);
    }

    let selectedIdx = 0;
    let inDetailView = false;

    const clearScreen = () => process.stdout.write('\x1b[2J\x1b[H');
    const hideCursor = () => process.stdout.write('\x1b[?25l');
    const showCursor = () => process.stdout.write('\x1b[?25h');
    const home = '\x1b[H';
    const clearLine = '\x1b[K';
    const clearBelow = '\x1b[J';

    const renderList = () => {
      const lines = [];
      const pid = isDaemonRunning();
      const daemonStatus = pid
        ? `${c.green}●${c.reset} Daemon running`
        : `${c.yellow}○${c.reset} Daemon stopped`;

      lines.push(`${c.bold}Tasks${c.reset}  ${c.dim}│${c.reset}  ${daemonStatus}`);
      lines.push('');

      tasks.forEach((task, idx) => {
        const selected = idx === selectedIdx;
        const prefix = selected ? `${c.cyan}❯${c.reset}` : ' ';
        const statusIcon = task.status === 'running' ? `${c.cyan}▶${c.reset}`
                         : task.status === 'active' ? `${c.green}●${c.reset}`
                         : task.status === 'done' ? `${c.dim}✓${c.reset}`
                         : `${c.yellow}○${c.reset}`;
        const name = selected ? `${c.bold}${task.taskName}${c.reset}` : task.taskName;
        const statusText = task.status === 'running' ? `${c.cyan}running${c.reset}` : task.status;
        const progressText = task.progress !== '—' ? ` ${c.green}${task.progress}${c.reset}` : '';
        const info = `${c.dim}${statusText}${c.reset}${progressText} ${c.dim}· ${task.lastRun === '—' ? 'never run' : task.lastRun}${c.reset}`;

        lines.push(`${prefix} ${statusIcon} ${name}  ${info}`);
      });

      lines.push('');
      lines.push(`${c.dim}↑/↓ select · enter view · r run · p pause · d done · x remove · q quit${c.reset}`);

      process.stdout.write(home + lines.map(l => l + clearLine).join('\n') + clearBelow);
    };

    let tailInterval = null;

    const renderDetail = () => {
      const lines = [];
      const task = tasks[selectedIdx];

      // Refresh task status for running check
      let currentState = {};
      try {
        if (fs.existsSync(DAEMON_STATE_FILE)) {
          currentState = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
        }
      } catch {}
      const isRunning = currentState.running === task.taskBranch;

      const statusColor = isRunning ? c.cyan
                        : task.status === 'active' ? c.green
                        : task.status === 'done' ? c.dim : c.yellow;
      const statusText = isRunning ? 'running' : task.status;

      lines.push(`${c.bold}${c.cyan}${task.taskName}${c.reset}`);
      lines.push('');
      lines.push(`  ${c.dim}Path:${c.reset}     ${task.projectDir}`);
      lines.push(`  ${c.dim}Status:${c.reset}   ${statusColor}${statusText}${c.reset}`);
      lines.push(`  ${c.dim}Progress:${c.reset} ${task.progress !== '—' ? c.green + task.progress + c.reset : c.dim + '—' + c.reset}`);
      lines.push(`  ${c.dim}Last run:${c.reset} ${task.lastRun}`);

      // Show criteria checklist
      if (task.criteria && task.criteria.length > 0) {
        lines.push('');
        lines.push(`${c.bold}Checklist${c.reset}`);
        lines.push('');
        task.criteria.forEach(item => {
          const check = item.done ? `${c.green}✓${c.reset}` : `${c.dim}○${c.reset}`;
          const text = item.done ? `${c.dim}${item.text}${c.reset}` : item.text;
          lines.push(`  ${check} ${text}`);
        });
      }

      // Get terminal height for log display
      const termHeight = process.stdout.rows || 24;
      const criteriaLines = task.criteria ? task.criteria.length + 2 : 0;
      const logLineCount = Math.max(3, termHeight - 14 - criteriaLines);

      const logs = getTaskLogs(task, logLineCount);
      const logTitle = isRunning ? `${c.bold}Live Log${c.reset} ${c.cyan}(tailing)${c.reset}` : `${c.bold}Recent Log${c.reset}`;
      lines.push('');
      lines.push(logTitle);
      lines.push('');

      if (logs.length > 0) {
        const maxWidth = (process.stdout.columns || 80) - 4;
        logs.forEach(line => {
          const display = line.length > maxWidth ? line.slice(0, maxWidth - 1) + '…' : line;
          lines.push(`  ${c.dim}${display}${c.reset}`);
        });
      } else {
        lines.push(`  ${c.dim}No logs yet${c.reset}`);
      }

      lines.push('');
      lines.push(`${c.dim}esc back · r run now · p pause · d done · x remove · q quit${c.reset}`);

      process.stdout.write(home + lines.map(l => l + clearLine).join('\n') + clearBelow);
    };

    const startTailing = () => {
      if (tailInterval) return;
      tailInterval = setInterval(() => {
        if (inDetailView) renderDetail();
      }, 1000);
    };

    const stopTailing = () => {
      if (tailInterval) {
        clearInterval(tailInterval);
        tailInterval = null;
      }
    };

    const render = () => {
      if (inDetailView) {
        renderDetail();
        // Start tailing if task is running
        const task = tasks[selectedIdx];
        let currentState = {};
        try {
          if (fs.existsSync(DAEMON_STATE_FILE)) {
            currentState = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf8'));
          }
        } catch {}
        if (currentState.running === task.taskBranch) {
          startTailing();
        } else {
          stopTailing();
        }
      } else {
        stopTailing();
        renderList();
      }
    };

    // Reload tasks list
    const reloadTasks = () => {
      const newTasks = loadTasks();
      tasks.length = 0;
      tasks.push(...newTasks);
      // Adjust selectedIdx if needed
      if (selectedIdx >= tasks.length) {
        selectedIdx = Math.max(0, tasks.length - 1);
      }
    };

    // Handle action
    const doAction = async (action) => {
      const task = tasks[selectedIdx];

      if (action === 'run') {
        // Run exits to hand over TTY
        showCursor();
        clearScreen();
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        console.log(`${c.cyan}▶${c.reset} Running ${c.bold}${task.taskName}${c.reset}...\n`);
        try {
          execSync(`agx claude -y -p "continue"`, { cwd: task.projectDir, stdio: 'inherit' });
        } catch {}
        process.exit(0);
      } else if (action === 'pause') {
        // Set status to paused
        clearScreen();
        console.log(`${c.yellow}⏸${c.reset} Pausing ${c.bold}${task.taskName}${c.reset}...`);
        try {
          execSync('mem set status paused', { cwd: task.projectDir, stdio: 'pipe' });
          console.log(`${c.green}✓${c.reset} Paused`);
        } catch (err) {
          console.log(`${c.yellow}Note:${c.reset} ${err.message || 'Could not pause'}`);
        }
        await new Promise(r => setTimeout(r, 500));
        inDetailView = false;
        reloadTasks();
        render();
      } else if (action === 'done') {
        // Set status to done
        clearScreen();
        console.log(`${c.green}✓${c.reset} Marking ${c.bold}${task.taskName}${c.reset} done...`);
        try {
          execSync('mem set status done', { cwd: task.projectDir, stdio: 'pipe' });
          console.log(`${c.green}✓${c.reset} Done`);
        } catch (err) {
          console.log(`${c.yellow}Note:${c.reset} ${err.message || 'Error marking done'}`);
        }
        await new Promise(r => setTimeout(r, 500));
        inDetailView = false;
        reloadTasks();
        render();
      } else if (action === 'remove') {
        clearScreen();
        console.log(`${c.red}✗${c.reset} Removing ${c.bold}${task.taskName}${c.reset}...`);
        const taskNameToRemove = task.taskName;
        const branchName = task.taskBranch || `task/${taskNameToRemove}`;
        try {
          const memDir = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');

          // Delete the git branch
          execSync(`git branch -D "${branchName}"`, { cwd: memDir, stdio: 'pipe' });

          // Remove from index.json if present
          const indexFile = path.join(memDir, 'index.json');
          if (fs.existsSync(indexFile)) {
            try {
              const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
              let changed = false;
              for (const [dir, branch] of Object.entries(index)) {
                if (branch === branchName) {
                  delete index[dir];
                  changed = true;
                }
              }
              if (changed) {
                fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
              }
            } catch {}
          }

          console.log(`${c.green}✓${c.reset} Deleted`);
        } catch (err) {
          console.log(`${c.yellow}Note:${c.reset} ${err.message || 'Error removing task'}`);
        }
        // Wait for git to settle, then manually remove from local array if still present
        await new Promise(r => setTimeout(r, 300));
        inDetailView = false;
        reloadTasks();
        // Double-check: filter out the removed task if it's still there
        const stillPresent = tasks.findIndex(t => t.taskName === taskNameToRemove);
        if (stillPresent !== -1) {
          tasks.splice(stillPresent, 1);
          if (selectedIdx >= tasks.length) {
            selectedIdx = Math.max(0, tasks.length - 1);
          }
        }
        if (tasks.length === 0) {
          showCursor();
          clearScreen();
          console.log(`${c.dim}No tasks remaining${c.reset}`);
          process.exit(0);
        }
        render();
      }
    };

    // Setup raw input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      hideCursor();
      render();

      process.stdin.on('data', async (key) => {
        const k = key.toString();

        if (k === 'q' || k === '\x03') { // q or ctrl-c
          stopTailing();
          showCursor();
          clearScreen();
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.exit(0);
        } else if (k === '\x1b[A' || k === 'k') { // up or k
          if (!inDetailView) {
            selectedIdx = Math.max(0, selectedIdx - 1);
            render();
          }
        } else if (k === '\x1b[B' || k === 'j') { // down or j
          if (!inDetailView) {
            selectedIdx = Math.min(tasks.length - 1, selectedIdx + 1);
            render();
          }
        } else if (k === '\r' || k === '\n' || k === 'l' || k === '\x1b[C') { // enter, l, or right
          inDetailView = true;
          render();
        } else if (k === '\x1b[D' || k === 'h' || (k === '\x1b' && k.length === 1)) { // left, h, or bare esc
          inDetailView = false;
          render();
        } else if (k === 'r') {
          await doAction('run');
        } else if (k === 'p') {
          await doAction('pause');
        } else if (k === 'd') {
          await doAction('done');
        } else if (k === 'x') {
          await doAction('remove');
        }
      });
    } else {
      // Non-interactive: just list
      console.log(`${c.bold}Tasks${c.reset}\n`);
      tasks.forEach((task, idx) => {
        const statusIcon = task.status === 'running' ? `${c.cyan}▶${c.reset}`
                         : task.status === 'active' ? `${c.green}●${c.reset}`
                         : task.status === 'done' ? `${c.dim}✓${c.reset}`
                         : `${c.yellow}○${c.reset}`;
        const progressText = task.progress !== '—' ? ` ${c.green}${task.progress}${c.reset}` : '';
        console.log(`${idx + 1}. ${statusIcon} ${task.taskName}${progressText}  ${c.dim}${task.status} · ${task.lastRun}${c.reset}`);
      });
      process.exit(0);
    }
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
    ? `  Default: ${config.defaultProvider}`
    : '';
  console.log(`agx - Autonomous AI Agent CLI

USAGE:
  agx -a -p "build something"     Autonomous: works until done
  agx -p "quick question"         One-shot prompt
${defaultNote}
AUTONOMOUS MODE (-a):
  One command does everything:

  $ agx -a -p "Build a REST API with auth"
  ✓ Created task: build-rest-api
  ✓ Daemon started
  ✓ Working...

  Agent runs continuously until [done] or [blocked].
  That's it. No manual task management needed.

OPTIONS:
  -a, --autonomous    Full auto: task + daemon + work until done
  -p, --prompt        The prompt/goal
  -y, --yolo          Skip prompts (implied by -a)
  -m, --model         Model name

PROVIDERS:
  claude, c    Anthropic Claude Code
  gemini, g    Google Gemini
  ollama, o    Local Ollama

CHECKING ON TASKS:
  agx tasks           Browse all tasks
  agx tail [task]     Live tail task log
  agx status          Current task status
  agx daemon logs     Daemon activity

MANUAL CONTROL (optional):
  agx run [task]      Run task now
  agx pause [task]    Pause scheduled runs
  agx stop [task]     Mark done
  agx stuck <reason>  Mark blocked

EXAMPLES:
  agx -a -p "Build a todo app"    # Start autonomous task
  agx claude -p "explain this"    # One-shot question
  agx tasks                       # Check on tasks
  agx daemon logs                 # See what's happening`);
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
  mem: null, // null = auto-detect, true = force on, false = force off
  memDir: null,
  autonomous: false,
  taskName: null,
  criteria: [],
  daemon: false,
  untilDone: false
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
      options.yolo = true; // Autonomous = unattended, skip prompts
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
    case '--continue':
      // Continue existing task (used by daemon)
      if (nextArg && !nextArg.startsWith('-')) {
        options.continueTask = nextArg;
        options.mem = true;
        options.yolo = true;
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
// When using --continue without a prompt, default to "continue"
const finalPrompt = options.prompt || positionalArgs.join(' ') || (options.continueTask ? 'continue' : null);

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

// Mem context logic:
// - agx -p "..." → one-shot, no task
// - agx -a -p "..." → create new task
// - agx -a --task <name> → use/create specific task
// - agx --continue <name> → continue existing task (used by daemon)

let memInfo = null;
const centralMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');

// --continue: load existing task context (used by daemon)
if (options.continueTask && options.mem !== false) {
  const branch = `task/${options.continueTask}`;
  if (fs.existsSync(centralMem)) {
    try {
      execSync(`git show-ref --verify refs/heads/${branch}`, { cwd: centralMem, stdio: 'ignore' });
      memInfo = { memDir: centralMem, taskBranch: branch, projectDir: process.cwd(), isLocal: false };
    } catch {
      console.error(`${c.red}Task not found:${c.reset} ${options.continueTask}`);
      process.exit(1);
    }
  }
}
// -a with --task: use/create specific task
else if (options.autonomous && options.taskName && options.mem !== false) {
  if (fs.existsSync(centralMem)) {
    const branch = `task/${options.taskName}`;
    try {
      execSync(`git show-ref --verify refs/heads/${branch}`, { cwd: centralMem, stdio: 'ignore' });
      memInfo = { memDir: centralMem, taskBranch: branch, projectDir: process.cwd(), isLocal: false };
    } catch {} // Task doesn't exist, will be created
  }
}
// -a without --task: create new task (handled below)

if (memInfo) {
  options.mem = true;
  options.memInfo = memInfo;
  options.memDir = memInfo.memDir;
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
    // Build mem new command with criteria if provided
    const criteriaArg = options.criteria.length
      ? ` --criteria "${options.criteria.join(', ')}"`
      : '';

    // Use mem CLI to create task
    execSync(`mem new "${taskName}" "${finalPrompt}"${criteriaArg}`, {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    const centralMem = path.join(process.env.HOME || process.env.USERPROFILE, '.mem');
    const branch = `task/${taskName}`;

    options.memDir = centralMem;
    options.memInfo = { memDir: centralMem, taskBranch: branch, projectDir: process.cwd(), isLocal: false };

    // Start daemon for autonomous mode
    if (options.autonomous) {
      startDaemon();
      console.log(`${c.green}✓${c.reset} Autonomous mode: daemon running\n`);
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

    // Pop nudges from mem (read and clear) - steering messages from user
    let nudgesSection = '';
    try {
      const nudgesOut = execSync(`mem pop nudges --json`, {
        cwd: options.memInfo.projectDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const { value } = JSON.parse(nudgesOut);
      if (value) {
        const nudges = JSON.parse(value);
        if (nudges.length > 0) {
          console.log(`${c.yellow}📬 Nudges from user:${c.reset}`);
          nudges.forEach(n => console.log(`  ${c.yellow}→${c.reset} ${n}`));
          console.log('');
          nudgesSection = `\n\n## 📬 Nudges from User\n\nThe user left these steering messages for you:\n\n${nudges.map(n => `- ${n}`).join('\n')}\n\n**Important:** Address these nudges in your work.\n`;
        }
      }
    } catch {}

    // Build augmented prompt with skill docs + context + workflow
    const augmentedPrompt = `## mem - Persistent Agent Memory

You have access to \`mem\` for tracking progress across sessions.

### Commands Available
\`\`\`bash
mem context              # Load full state (already done - see below)
mem checkpoint "msg"     # Save progress point
mem learn "insight"      # Record a learning
mem criteria <n>         # Mark criterion #n complete
mem next "step"          # Set next step for future self
mem done                 # Task complete (all criteria met)
mem stuck "reason"       # Blocked, need human help
\`\`\`

### Agent Workflow
1. Review context below (goal, criteria, progress, next step)
2. Work on the current next step
3. Use \`mem checkpoint\` to save progress periodically
4. Use \`mem learn\` when you discover something useful
5. Use \`mem criteria N\` when you complete a criterion
6. Use \`mem next\` before stopping to guide your future self
7. Only use \`mem done\` when ALL criteria are complete
8. Only use \`mem stuck\` if you truly cannot proceed

---

## Current Context

${context}${nudgesSection}

---

## Your Task

${finalPrompt}

---

## Output Markers (Alternative to CLI)

You can also use inline markers that will be parsed automatically:

- [checkpoint: message] - save progress point
- [learn: insight] - record a learning
- [next: step] - set what to work on next
- [criteria: N] - mark criterion #N complete

Stopping markers (only when appropriate):
- [done] - task complete (all criteria met)
- [blocked: reason] - need human help

The default is to keep working. The daemon will continue automatically.`;

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
      
      // Handle loop control
      if (result.isDone) {
        console.log(`\n${c.green}✓ Task complete!${c.reset}`);
        try {
          execSync('mem set status done', { cwd: process.cwd(), stdio: 'ignore' });
          console.log(`${c.dim}Task marked done.${c.reset}`);
        } catch {}
        process.exit(0);
      } else if (result.isBlocked) {
        console.log(`\n${c.yellow}⚠ Task blocked. Human intervention needed.${c.reset}`);
        console.log(`${c.dim}Task paused. Run 'agx resume' when ready.${c.reset}`);
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
        // Default: daemon will continue automatically
        console.log(`\n${c.dim}Progress saved. Daemon will continue automatically.${c.reset}`);
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

#!/usr/bin/env node

// ============================================================
// agx - AI Agent Task Orchestrator
//
// Architecture:
// - agx ORCHESTRATES tasks and AI agents (claude, gemini, ollama, codex)
// - agx Cloud API STORES task data
// - This separation keeps agx focused on orchestration
//
// Data flow:
//   agx new "goal" -P claude
//     → cloud API creates task
//
//   agx context --json
//     → returns {task, provider, goal, criteria, checkpoints...} via cloud
//
//   daemon runs tasks
//     → reads provider per task
//     → spawns: agx <provider> --continue <task>
// ============================================================

const { spawn, spawnSync, execSync } = require('child_process');
const pMap = require('p-map');
const pRetry = require("p-retry");
const pRetryFn = pRetry.default || pRetry;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement
} = require('./lib/stage-requirements');
const { createOrchestrator } = require('./lib/orchestrator');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CLOUD_CONFIG_FILE = path.join(CONFIG_DIR, 'cloud.json');

// agx skill - instructions for LLMs on how to use agx
const AGX_SKILL = `---
name: agx
description: Task orchestrator for AI agents. Uses cloud API for persistence.
---

# agx - AI Agent Task Orchestrator

agx manages tasks and coordinates AI agents. Uses cloud API for persistence.

## Quick Start

\`\`\`bash
agx -a -p "Build a REST API"  # Autonomous: works until done
agx -p "explain this code"     # One-shot question
\`\`\`

## Task Lifecycle

\`\`\`bash
agx new "goal"          # Create task
agx run [task]          # Run a task
agx complete <taskId>   # Mark task stage complete
agx status              # Show current status
\`\`\`

## Checking Tasks

\`\`\`bash
agx task ls             # List tasks
agx task logs <id> [-f] # View/tail task logs
agx task tail <id>      # Tail task logs
agx comments tail <id>  # Tail task comments
agx logs tail <id>      # Tail task logs
agx watch               # Watch task updates in real-time (SSE)
\`\`\`

## Authentication

\`\`\`bash
agx login [url]   # Login to AGX Cloud
agx logout        # Logout from cloud
agx status        # Show connection status
agx task ls           # List cloud tasks
agx task logs <id> [-f]  # View/tail task logs
agx task tail <id>       # Tail task logs
agx comments clear <id>  # Clear task comments
agx comments ls <id>     # List task comments
agx comments tail <id>   # Tail task comments
agx logs clear <id>      # Clear task logs
agx logs ls <id>         # List task logs
agx logs tail <id>       # Tail task logs
agx task stop <id>      # Stop a task
agx task rm <id>        # Remove a task
agx container ls        # List running containers
agx container logs      # View daemon logs
agx container stop      # Stop containers
agx new "task"    # Create task
agx complete <taskId>   # Mark task stage complete
agx done [task]   # Mark task done
agx watch         # Watch task updates in real-time (SSE)
agx daemon start  # Start local daemon
\`\`\`

## Providers

claude (c), gemini (g), ollama (o), codex (x)

## Key Flags

-a  Autonomous mode (daemon + work until done)
-p  Prompt/goal
-y  Skip confirmations (implied by -a)
-P, --provider <c|g|o|x>  Provider for new task (claude/gemini/ollama/codex)
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

const SWARM_PROVIDERS = ['claude', 'gemini', 'ollama', 'codex'];
const SWARM_TIMEOUT_MS = Number(process.env.AGX_SWARM_TIMEOUT_MS || 10 * 60 * 1000);
const SWARM_RETRIES = Number(process.env.AGX_SWARM_RETRIES || 1);
const SWARM_MAX_ITERS = Number(process.env.AGX_SWARM_MAX_ITERS || 0);
const SWARM_LOG_FLUSH_MS = Number(process.env.AGX_SWARM_LOG_FLUSH_MS || 500);
const SWARM_LOG_MAX_BYTES = Number(process.env.AGX_SWARM_LOG_MAX_BYTES || 8000);
const RETRY_FLOW_PREFIX = '[retry-flow]';
let retryFlowActive = false;

function logRetryFlow(step, phase, detail = '') {
  //if (!retryFlowActive) return;
  if (['cloudRequest', 'loadCloudConfig'].includes(step)) return;
  const info = detail ? ` | ${detail}` : '';
  console.log(`${RETRY_FLOW_PREFIX} ${step} | ${phase}${info}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check if a command exists
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function spawnCloudTaskProcess(childArgs, options = {}) {
  const useScriptTty = commandExists('script');
  const spawnCmd = useScriptTty ? 'script' : process.execPath;
  const spawnArgs = useScriptTty
    ? ['-q', '/dev/null', process.execPath, ...childArgs]
    : childArgs;
  return spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function sanitizeCliArg(value) {
  return String(value ?? '').replace(/\u0000/g, '');
}

function sanitizeCliArgs(values) {
  return values.map(sanitizeCliArg);
}

function loadCloudConfigFile() {
  try {
    if (fs.existsSync(CLOUD_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
    }
  } catch { }
  return null;
}

function truncateForComment(text, maxChars = 14000) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

async function postTaskLog(taskId, content, logType) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl || !cloudConfig?.token) return;

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudConfig.token}`,
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify({ content, log_type: logType })
    });
  } catch { }
}

async function postTaskComment(taskId, content) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl || !cloudConfig?.token) return;
  if (!taskId) return;
  if (!content) return;
  logRetryFlow('postTaskComment', 'input', `taskId=${taskId}`);
  logRetryFlow('postTaskComment', 'processing', `POST /api/tasks/${taskId}/comments`);

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudConfig.token}`,
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify({ content })
    });
    logRetryFlow('postTaskComment', 'output', 'success');
  } catch (err) {
    logRetryFlow('postTaskComment', 'output', `failed ${err?.message || err}`);
  }
}

function saveAugmentedPrompt(content, debug = false) {
  if (!content) return;
  const AUGMENTED_PROMPT_FILE = path.join(CONFIG_DIR, 'augmented-prompt.txt');
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(AUGMENTED_PROMPT_FILE, `${content}\n`, 'utf8');
  } catch (err) {
    if (debug) {
      console.error(`Failed to write augmented prompt to ${AUGMENTED_PROMPT_FILE}:`, err?.message || err);
    }
  }
}

async function fetchTaskLogsFromCloud(taskId) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl || !cloudConfig?.token) return [];
  if (!taskId) return [];
  try {
    const response = await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/logs`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudConfig.token}`,
        'x-user-id': cloudConfig.userId || '',
      },
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data?.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

function buildLogTranscript(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return '(no logs captured)';
  return logs.map((log) => {
    const when = log?.created_at ? new Date(log.created_at).toISOString() : 'unknown-time';
    const type = String(log?.log_type || 'output');
    const content = String(log?.content || '');
    return `[${when}] [${type}] ${content}`;
  }).join('\n');
}

async function summarizeExecutionFromLogs({ taskId, task, command, mode, exitCode, fallbackPayload, provider, model }) {
  const logs = await fetchTaskLogsFromCloud(taskId);
  const transcript = buildLogTranscript(logs);
  const trimmedTranscript = transcript.trim();

  await postTaskComment(taskId, `[execution/raw]\n${truncateForComment(trimmedTranscript || '(no logs captured)')}`);

  const aggregatorProvider = String(provider || task?.provider || task?.engine || 'claude').toLowerCase();
  const aggregatorModel = typeof model === 'string' && model.trim()
    ? model.trim()
    : resolveAggregatorModel(task);
  const transcriptForLlm = truncateForComment(trimmedTranscript, 30000);
  const prompt = `You are an execution log analyzer.
Command: ${command}
Mode: ${mode}
Exit code: ${Number(exitCode) || 0}

Analyze the execution transcript and return only strict JSON:
{"decision":"done|blocked|not_done|failed","explanation":"string","final_result":"string","summary":"string"}

Rules:
- Keep final_result concise and actionable.
- Capture concrete errors if failed/blocked.
- Do not include markdown or code fences.

Transcript:
${transcriptForLlm}
`;

  let payload = {
    decision: fallbackPayload.decision,
    final_result: fallbackPayload.final_result,
    explanation: fallbackPayload.explanation,
  };

  try {
    const args = [aggregatorProvider, '--prompt', prompt, '--print'];
    if (aggregatorModel) args.push('--model', aggregatorModel);
    const res = await runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} summarize`);
    const extracted = extractJson(res.stdout) || extractJson(res.stderr);
    if (extracted && typeof extracted === 'object') {
      const extractedDecision = typeof extracted.decision === 'string' ? extracted.decision.trim() : '';
      const allowedDecision = ['done', 'blocked', 'not_done', 'failed'].includes(extractedDecision)
        ? extractedDecision
        : fallbackPayload.decision;
      payload = {
        decision: allowedDecision,
        final_result: typeof extracted.final_result === 'string' && extracted.final_result.trim()
          ? extracted.final_result.trim()
          : fallbackPayload.final_result,
        explanation: typeof extracted.explanation === 'string' && extracted.explanation.trim()
          ? extracted.explanation.trim()
          : fallbackPayload.explanation,
      };
    }
  } catch { }

  await postTaskComment(taskId, `[execution/extracted]\n${truncateForComment(payload.final_result || '(empty)')}`);
  await postTaskComment(
    taskId,
    `[execution/decision]\ncommand: ${command}\nmode: ${mode}\nexit_code: ${Number(exitCode) || 0}\ndecision: ${payload.decision}\nexplanation: ${truncateForComment(payload.explanation || '(none)', 4000)}`
  );

  return payload;
}

async function postLearning(taskId, content) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl || !cloudConfig?.token) return;
  if (!content) return;

  logRetryFlow('postLearning', 'input', `taskId=${taskId}, content=${content}`);
  logRetryFlow('postLearning', 'processing', 'POST /api/learnings');

  try {
    await fetch(`${cloudConfig.apiUrl}/api/learnings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudConfig.token}`,
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify({
        scope: 'task',
        scopeId: taskId,
        content
      })
    });
    logRetryFlow('postLearning', 'output', 'success');
  } catch (err) {
    logRetryFlow('postLearning', 'output', `failed ${err?.message || err}`);
  }
}

async function patchTaskState(taskId, state) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl || !cloudConfig?.token) return;

  logRetryFlow('patchTaskState', 'input', `taskId=${taskId}, state=${JSON.stringify(state)}`);
  logRetryFlow('patchTaskState', 'processing', `PATCH /api/tasks/${taskId}`);

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudConfig.token}`,
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify(state)
    });
    logRetryFlow('patchTaskState', 'output', 'success');
  } catch (err) {
    logRetryFlow('patchTaskState', 'output', `failed ${err?.message || err}`);
  }
}

function createTaskLogger(taskId) {
  const buffers = {
    output: '',
    error: '',
    system: '',
    checkpoint: ''
  };
  const tails = {
    output: '',
    error: ''
  };
  const timers = {
    output: null,
    error: null,
    system: null,
    checkpoint: null
  };
  let updateChain = Promise.resolve();

  const scheduleFlush = (type) => {
    if (timers[type]) return;
    timers[type] = setTimeout(() => flush(type), SWARM_LOG_FLUSH_MS);
  };

  const flush = async (type) => {
    if (timers[type]) {
      clearTimeout(timers[type]);
      timers[type] = null;
    }
    const content = buffers[type];
    if (!content) return;
    buffers[type] = '';
    await postTaskLog(taskId, content, type);
  };

  const updateTaskSection = async (heading, content, mode = 'replace') => {
    const cloudConfig = loadCloudConfigFile();
    if (!cloudConfig?.apiUrl || !cloudConfig?.token) return;

    logRetryFlow('updateTaskSection', 'input', `taskId=${taskId}, heading=${heading}, mode=${mode}`);
    logRetryFlow('updateTaskSection', 'processing', `GET /api/tasks/${taskId}`);
    try {
      const res = await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudConfig.token}`,
          'x-user-id': cloudConfig.userId || '',
        }
      });
      if (!res.ok) return;
      const data = await res.json();
      const task = data.task;
      if (!task?.content) return;

      const original = task.content;
      const sectionRegex = new RegExp(`(^##\\s+${heading}\\s*$)([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'im');
      let updated = original;
      if (sectionRegex.test(original)) {
        updated = original.replace(sectionRegex, (m, h, body) => {
          if (mode === 'append') {
            const existing = body.trim();
            const nextBody = existing ? `${existing}\n${content}` : content;
            return `${h}\n\n${nextBody}\n`;
          }
          return `${h}\n\n${content}\n`;
        });
      } else {
        updated = `${original.trim()}\n\n## ${heading}\n\n${content}\n`;
      }

      if (updated !== original) {
        logRetryFlow('updateTaskSection', 'processing', 'PUT content update');
        await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cloudConfig.token}`,
            'x-user-id': cloudConfig.userId || '',
          },
          body: JSON.stringify({ content: updated })
        });
        logRetryFlow('updateTaskSection', 'output', 'updated');
      } else {
        logRetryFlow('updateTaskSection', 'output', 'no change');
      }
    } catch (err) {
      logRetryFlow('updateTaskSection', 'output', `failed ${err?.message || err}`);
    }
  };

  const enqueueUpdate = (fn) => {
    updateChain = updateChain.then(fn).catch(() => { });
    return updateChain;
  };

  const parseLearnings = (type, text) => {
    if (type !== 'output') return;
    const combined = (tails[type] || '') + text;
    const regex = /(?:^|\n)\[learn:\s*([^\]\n]+)\]/gi;
    let match;
    while ((match = regex.exec(combined)) !== null) {
      const insight = (match[1] || '').trim();
      if (insight) {
        postLearning(taskId, insight);
        const entry = `- ${new Date().toISOString()} ${insight}`;
        enqueueUpdate(() => updateTaskSection('Learnings', entry, 'append'));
      }
    }
    tails[type] = combined.slice(-200);
  };

  const parseMarkers = (type, text) => {
    if (type !== 'output') return;
    const combined = (tails[type] || '') + text;
    const regex = /(?:^|\n)\[(plan|todo|checkpoint):\s*([^\]\n]+)\]/gi;
    let match;
    while ((match = regex.exec(combined)) !== null) {
      const kind = (match[1] || '').toLowerCase();
      const value = (match[2] || '').trim();
      if (!value) continue;
      if (kind === 'plan') {
        enqueueUpdate(() => updateTaskSection('Plan', value, 'replace'));
      } else if (kind === 'todo') {
        enqueueUpdate(() => updateTaskSection('Todo', value, 'replace'));
      } else if (kind === 'checkpoint') {
        const entry = `- ${new Date().toISOString()} ${value}`;
        enqueueUpdate(() => updateTaskSection('Checkpoints', entry, 'append'));
      }
    }
    tails[type] = combined.slice(-200);
  };

  const log = (type, chunk) => {
    if (!chunk) return;
    const text = chunk.toString();
    parseLearnings(type, text);
    parseMarkers(type, text);
    buffers[type] += text;
    if (buffers[type].length >= SWARM_LOG_MAX_BYTES) {
      flush(type);
      return;
    }
    scheduleFlush(type);
  };

  const flushAll = async () => {
    await Promise.all(Object.keys(buffers).map((t) => flush(t)));
  };

  return { log, flushAll };
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    // Remove common markdown wrappers the model might add
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    // Remove ANSI escape codes that can leak into provider output
    .replace(/\u001b\[[0-9;]*m/g, '');

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: walk brace-balanced candidates and parse the first valid object.
    for (let i = 0; i < cleaned.length; i += 1) {
      if (cleaned[i] !== '{') continue;
      let depth = 0;
      for (let j = i; j < cleaned.length; j += 1) {
        const ch = cleaned[j];
        if (ch === '{') depth += 1;
        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const maybe = cleaned.slice(i, j + 1);
            try {
              return JSON.parse(maybe);
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }
}

function ensureNextPrompt(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  if (decision.done) return decision;
  if (typeof decision.next_prompt === 'string' && decision.next_prompt.trim()) return decision;

  const source = [decision.explanation, decision.summary, decision.final_result]
    .find((v) => typeof v === 'string' && v.trim());

  const fallback = source
    ? `Continue the task with this guidance: ${source.trim()}`
    : 'Continue the task by identifying the next concrete step, implementing it, and verifying the result.';

  return {
    ...decision,
    next_prompt: fallback
  };
}

function extractSection(markdown, heading) {
  if (!markdown) return '';
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(markdown);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/im);
  const section = next === -1 ? rest : rest.slice(0, next);
  return section.trim();
}

function parseFrontmatterFromContent(content) {
  if (!content) return {};
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function normalizeTicketType(value) {
  if (typeof value !== 'string') return 'task';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'task';
  if (normalized === 'spike' || normalized === 'spikes') return 'spike';
  return 'task';
}

function resolveTaskTicketType(task) {
  const frontmatter = parseFrontmatterFromContent(task?.content || '');
  const candidates = [
    task?.ticket_type,
    task?.type,
    task?.issue_type,
    task?.kind,
    frontmatter.ticket_type,
    frontmatter.type,
    frontmatter.issue_type,
    frontmatter.kind,
  ];
  for (const candidate of candidates) {
    const resolved = normalizeTicketType(candidate);
    if (resolved === 'spike') return 'spike';
  }

  const title = String(task?.title || '').trim().toLowerCase();
  if (title.startsWith('spike:') || title.startsWith('[spike]')) {
    return 'spike';
  }
  return 'task';
}

function parseList(value) {
  if (!value || typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean);
      }
    } catch { }
  }
  return trimmed
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function runAgxCommand(args, timeoutMs, label, handlers = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const childArgs = sanitizeCliArgs([process.argv[1], ...args]);
    logRetryFlow('runAgxCommand', 'input', `label=${label}, args=${childArgs.join(' ')}, timeout=${timeoutMs}`);
    logRetryFlow('runAgxCommand', 'processing', 'spawning child process');
    const child = spawnCloudTaskProcess(childArgs);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    controller.signal.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      const err = new Error(`${label || 'command'} timed out`);
      err.code = 'ETIMEDOUT';
      clearTimeout(timeout);
      reject(err);
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (handlers.onStdout) handlers.onStdout(data);
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (handlers.onStderr) handlers.onStderr(data);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      logRetryFlow('runAgxCommand', 'output', `error ${err?.message || err}`);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      logRetryFlow('runAgxCommand', 'output', `exit code=${code}`);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(`${label || 'command'} exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

async function runSwarmIteration({ taskId, task, prompt, logger }) {
  logRetryFlow('runSwarmIteration', 'input', `taskId=${taskId}, prompt=${Boolean(prompt)}`);
  const swarmModels = Array.isArray(task?.swarm_models)
    ? task.swarm_models
      .filter((entry) => entry && entry.provider && entry.model)
      .map((entry) => ({
        provider: String(entry.provider).toLowerCase(),
        model: String(entry.model)
      }))
    : [];

  const providers = (swarmModels.length ? swarmModels.map((m) => m.provider) : SWARM_PROVIDERS)
    .map((p) => p.toLowerCase());

  const missing = providers.filter((p) => !commandExists(p));
  if (missing.length) {
    throw new Error(`Missing providers for swarm run: ${missing.join(', ')}`);
  }

  logRetryFlow('runSwarmIteration', 'processing', `providers=${providers.join(',')}`);
  logger?.log('system', `[swarm] iteration start\n`);

  const results = await pMap(providers, (provider, index) => {
    const args = [provider, '--cloud-task', taskId];
    const modelForProvider = swarmModels.length
      ? swarmModels[index]?.model || null
      : null;
    if (modelForProvider) {
      args.push('--model', modelForProvider);
    }
    if (prompt) {
      args.push('--prompt', buildAgentIterationPrompt(task, prompt));
    }

    return pRetryFn(
      () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
        onStdout: (data) => logger?.log('output', data),
        onStderr: (data) => logger?.log('error', data)
      }),
      {
        retries: SWARM_RETRIES,
      }
    ).then((res) => ({
      provider,
      output: res.stdout || res.stderr || ''
    }));
  }, { concurrency: providers.length });

  for (const result of results) {
    logger?.log('output', `\n[${result.provider}] ${result.output}\n`);
  }

  logRetryFlow('runSwarmIteration', 'output', `providers finished count=${results.length}`);
  return results;
}

async function runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr }) {
  logRetryFlow('runSingleAgentIteration', 'input', `taskId=${taskId}, provider=${provider}, model=${model}, prompt=${Boolean(prompt) ? 'present' : 'none'}`);
  logRetryFlow('runSingleAgentIteration', 'processing', 'preparing runAgxCommand');
  const args = [provider, '--cloud-task', taskId];
  if (model) {
    args.push('--model', model);
  }
  if (prompt) {
    args.push('--prompt', buildAgentIterationPrompt(task, prompt));
  }

  const res = await pRetryFn(
    () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
      onStdout: (data) => {
        if (onStdout) onStdout(data);
        logger?.log('output', data);
      },
      onStderr: (data) => {
        if (onStderr) onStderr(data);
        logger?.log('error', data);
      }
    }),
    { retries: SWARM_RETRIES }
  );

  const outputSource = res.stdout || res.stderr || '';
  logRetryFlow('runSingleAgentIteration', 'output', `response length=${outputSource.length}`);
  return res.stdout || res.stderr || '';
}

function resolveAggregatorModel(task) {
  const explicitAggregatorModel = typeof task?.engine_model === 'string' && task.engine_model.trim()
    ? task.engine_model.trim()
    : (typeof task?.aggregator_model === 'string' && task.aggregator_model.trim() ? task.aggregator_model.trim() : null);
  if (explicitAggregatorModel) return explicitAggregatorModel;

  if (typeof task?.model === 'string' && task.model.trim()) {
    return task.model.trim();
  }
  return null;
}

function buildAgentIterationPrompt(task, prompt) {
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
  const instruction = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim()
    : 'Continue the next concrete step for this stage and verify the result.';

  return `Stage: ${stageKey}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}
Instruction: ${instruction}

Keep work scoped to this stage.`;
}

async function runSingleAgentAggregate({ task, taskId, prompt, output, iteration, logger, provider, model }) {
  logRetryFlow('runSingleAgentAggregate', 'input', `taskId=${taskId}, iteration=${iteration}`);
  logRetryFlow('runSingleAgentAggregate', 'processing', 'running aggregator');
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
  const aggregatorProvider = String(provider || task?.provider || task?.engine || 'claude').toLowerCase();
  const aggregatorModel = typeof model === 'string' && model.trim() ? model.trim() : null;

  const aggregatePrompt = `You are the decision aggregator for a single-agent run.

Task ID: ${taskId}
Title: ${task?.title || taskId}
Stage: ${task?.stage || 'unknown'}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}
User Request: ${task?.title || taskId}
Iteration: ${iteration}

${prompt ? `Latest instruction:\n${prompt}\n` : ''}

Output:
${output || '(no output)'}

Decide if the task is done. If not, provide the next instruction for another iteration.
Only set "done": true when the Stage Completion Requirement is satisfied.
Output contract (strict):
- Return exactly one raw JSON object and nothing else.
- Do not use markdown/code fences/backticks.
- Do not add commentary before/after JSON.
- Use double-quoted keys and strings.
- Keep newlines escaped inside strings.
- If "done" is false, "next_prompt" must be a non-empty actionable instruction.
Return ONLY JSON with this exact shape:
{"done": true|false, "decision": "done|blocked|not_done|failed", "explanation": "string", "final_result": "string", "next_prompt": "string", "summary": "string"}
If uncertain, still return valid JSON with decision "failed" and explain why in "explanation".
`;

  const aggregateArgs = [aggregatorProvider, '--prompt', aggregatePrompt, '--print'];
  if (aggregatorModel) {
    aggregateArgs.push('--model', aggregatorModel);
  }

  const res = await pRetryFn(
    () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
      onStdout: (data) => logger?.log('checkpoint', data),
      onStderr: (data) => logger?.log('error', data)
    }),
    { retries: SWARM_RETRIES }
  );

  const decision = extractJson(res.stdout) || extractJson(res.stderr);
  logRetryFlow('runSingleAgentAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
  if (!decision) {
    logger?.log('error', '[single] Aggregator returned invalid JSON\n');
    return { done: true, decision: 'failed', explanation: 'Aggregator response was not valid JSON.', final_result: 'Aggregator response was not valid JSON.', next_prompt: '', summary: 'Aggregator response was not valid JSON.' };
  }

  logger?.log('checkpoint', `[single] decision ${JSON.stringify(decision)}\n`);

  return enforceStageRequirement({
    done: Boolean(decision.done),
    decision: typeof decision.decision === 'string' ? decision.decision : '',
    explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
    final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
    next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
    summary: typeof decision.summary === 'string' ? decision.summary : ''
  }, { stage: stageKey, stagePrompt });
}

async function runSingleAgentLoop({ taskId, task, provider, model, logger, onStdout, onStderr }) {
  logRetryFlow('runSingleAgentLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}`);
  let iteration = 1;
  let prompt = '';
  let lastDecision = null;

  while (SWARM_MAX_ITERS === 0 || iteration <= 3) {
    logRetryFlow('runSingleAgentLoop', 'processing', `iteration ${iteration} start`);
    logger?.log('system', `[single] iteration ${iteration} start\n`);
    if (iteration === 1) {
      console.log(`${c.dim}[single] Starting single-agent run...${c.reset}`);
    }
    let output = '';
    try {
      output = await runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr });
    } catch (err) {
      const message = err?.stdout || err?.stderr || err?.message || 'Single-agent run failed.';
      console.log(`${c.red}[single] Failed: ${err?.message || 'Single-agent run failed.'}${c.reset}`);
      logRetryFlow('runSingleAgentLoop', 'output', `iteration ${iteration} failed ${err?.message || 'run failed'}`);
      lastDecision = {
        decision: 'failed',
        explanation: err?.message || 'Single-agent run failed.',
        final_result: message,
        summary: err?.message || 'Single-agent run failed.',
        done: false
      };
      return { code: 1, decision: lastDecision };
    }

    const decision = ensureNextPrompt(
      await runSingleAgentAggregate({ task, taskId, prompt, output, iteration, logger, provider, model })
    );

    console.log(JSON.stringify(decision, null, 2));
    lastDecision = decision;

    if (decision.summary) {
      console.log(`${c.dim}[single] Decision: ${decision.summary}${c.reset}`);
    }
    logRetryFlow('runSingleAgentLoop', 'output', `decision ${iteration} ${decision.decision}`);

    if (['done', 'blocked'].includes(decision.decision)) {
      logRetryFlow('runSingleAgentLoop', 'output', `done at iteration ${iteration}`);
      return { code: 0, decision: lastDecision };
    }

    prompt = decision.next_prompt || '';
    iteration += 1;
  }

  if (!lastDecision) {
    lastDecision = {
      decision: 'not_done',
      explanation: 'Single-agent run reached max iterations.',
      final_result: 'Single-agent run reached max iterations.',
      summary: 'Single-agent run reached max iterations.',
      done: false
    };
  }

  return { code: 1, decision: lastDecision };
}

async function runSwarmAggregate({ task, taskId, prompt, results, iteration, logger }) {
  const providerList = results.map((r) => r.provider).join(',');
  logRetryFlow('runSwarmAggregate', 'input', `taskId=${taskId}, iteration=${iteration}, providers=${providerList}`);
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
  const aggregatorProvider = String(task?.engine || task?.provider || 'claude').toLowerCase();
  const aggregatorModel = resolveAggregatorModel(task);

  const outputs = results
    .map((r) => `### ${r.provider.toUpperCase()}\n${r.output || '(no output)'}`)
    .join('\n\n');

  const aggregatePrompt = `You are the swarm aggregator.

Task ID: ${taskId}
Title: ${task?.title || taskId}
Stage: ${task?.stage || 'unknown'}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}
User Request: ${task?.title || taskId}
Iteration: ${iteration}

${prompt ? `Latest instruction:\n${prompt}\n` : ''}

Outputs:
${outputs}

Decide if the task is done. If not, provide the next instruction for another iteration.
Only set "done": true when the Stage Completion Requirement is satisfied.
Output contract (strict):
- Return exactly one raw JSON object and nothing else.
- Do not use markdown/code fences/backticks.
- Do not add commentary before/after JSON.
- Use double-quoted keys and strings.
- Keep newlines escaped inside strings.
- If "done" is false, "next_prompt" must be a non-empty actionable instruction.
Return ONLY JSON with this exact shape:
{"done": true|false, "decision": "done|blocked|not_done|failed", "explanation": "string", "final_result": "string", "next_prompt": "string", "summary": "string"}
If uncertain, still return valid JSON with decision "failed" and explain why in "explanation".
`;

  const aggregateArgs = [aggregatorProvider, '--prompt', aggregatePrompt, '--print'];
  if (aggregatorModel) {
    aggregateArgs.push('--model', aggregatorModel);
  }

  logRetryFlow('runSwarmAggregate', 'processing', 'running aggregator');
  const res = await pRetryFn(
    () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
      onStdout: (data) => logger?.log('checkpoint', data),
      onStderr: (data) => logger?.log('error', data)
    }),
    { retries: SWARM_RETRIES }
  );

  const decision = extractJson(res.stdout) || extractJson(res.stderr);
  logRetryFlow('runSwarmAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
  if (!decision) {
    logger?.log('error', '[swarm] Aggregator returned invalid JSON\n');
    return {
      done: true,
      decision: 'failed',
      explanation: 'Aggregator response was not valid JSON.',
      final_result: 'Aggregator response was not valid JSON.',
      next_prompt: '',
      summary: 'Aggregator response was not valid JSON.'
    };
  }

  logger?.log('checkpoint', `[swarm] decision ${JSON.stringify(decision)}\n`);

  return enforceStageRequirement({
    done: Boolean(decision.done),
    decision: typeof decision.decision === 'string' ? decision.decision : '',
    explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
    final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
    next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
    summary: typeof decision.summary === 'string' ? decision.summary : ''
  }, { stage: stageKey, stagePrompt });
}

async function runSwarmLoop({ taskId, task }) {
  logRetryFlow('runSwarmLoop', 'input', `taskId=${taskId}`);
  let iteration = 1;
  let prompt = '';
  const logger = createTaskLogger(taskId);
  let lastDecision = null;

  await patchTaskState(taskId, { status: 'in_progress', started_at: new Date().toISOString() });
  logger.log('system', `[swarm] start ${new Date().toISOString()}\n`);

  try {
    while (SWARM_MAX_ITERS === 0 || iteration <= SWARM_MAX_ITERS) {
      logRetryFlow('runSwarmLoop', 'processing', `starting iteration ${iteration}`);
      const results = await runSwarmIteration({ taskId, task, prompt, logger });
      const decision = ensureNextPrompt(
        await runSwarmAggregate({ task, taskId, prompt, results, iteration, logger })
      );
      lastDecision = decision;

      if (decision.summary) {
        console.log(`${c.dim}[swarm] ${decision.summary}${c.reset}`);
      }
      logRetryFlow('runSwarmLoop', 'output', `iteration ${iteration} decision=${decision.decision}`);

      if (decision.done) {
        logRetryFlow('runSwarmLoop', 'output', `done at iteration ${iteration}`);
        logger.log('system', `[swarm] done ${new Date().toISOString()}\n`);
        await logger.flushAll();
        await patchTaskState(taskId, { status: 'completed', completed_at: new Date().toISOString() });
        return { code: 0, decision: lastDecision };
      }

      prompt = decision.next_prompt || '';
      iteration += 1;
    }

    if (SWARM_MAX_ITERS > 0) {
      console.log(`${c.yellow}[swarm] Max iterations reached (${SWARM_MAX_ITERS}).${c.reset}`);
      logRetryFlow('runSwarmLoop', 'output', `max iterations reached ${SWARM_MAX_ITERS}`);
      logger.log('system', `[swarm] max iterations reached\n`);
      await logger.flushAll();
      await patchTaskState(taskId, { completed_at: new Date().toISOString() });
      if (!lastDecision) {
        lastDecision = {
          decision: 'not_done',
          explanation: 'Swarm reached max iterations.',
          final_result: 'Swarm reached max iterations.',
          summary: 'Swarm reached max iterations.',
          done: false
        };
      }
      return { code: 1, decision: lastDecision };
    }
    await logger.flushAll();
    await patchTaskState(taskId, { completed_at: new Date().toISOString() });
    return { code: 0, decision: lastDecision };
  } catch (err) {
    logger.log('error', `[swarm] failed: ${err.message}\n`);
    logRetryFlow('runSwarmLoop', 'output', `failed ${err?.message || 'unknown'}`);
    await logger.flushAll();
    await patchTaskState(taskId, { status: 'failed', completed_at: new Date().toISOString() });
    if (!lastDecision) {
      lastDecision = {
        decision: 'failed',
        explanation: err?.message || 'Swarm failed.',
        final_result: err?.message || 'Swarm failed.',
        summary: err?.message || 'Swarm failed.',
        done: false
      };
    }
    return { code: 1, decision: lastDecision };
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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopDaemonProcessTree(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  const killTree = (signal) => {
    try {
      // Daemon started with detached=true, so pid is process-group leader.
      process.kill(-pid, signal);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false;
      // Fallback to single-process signal if process-group signaling is unsupported.
      process.kill(pid, signal);
      return true;
    }
  };

  killTree('SIGTERM');
  while (isPidAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }

  if (!isPidAlive(pid)) return true;

  killTree('SIGKILL');
  await sleep(150);
  return !isPidAlive(pid);
}

function startDaemon(options = {}) {
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
  const daemonArgs = [agxPath, 'daemon', 'run'];
  if (options.maxWorkers && Number.isFinite(options.maxWorkers) && options.maxWorkers > 0) {
    daemonArgs.push('--workers', String(options.maxWorkers));
  }

  const daemon = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore',
      fs.openSync(DAEMON_LOG_FILE, 'a'),
      fs.openSync(DAEMON_LOG_FILE, 'a')
    ],
    env: {
      ...process.env,
      AGX_DAEMON: '1',
      ...(options.maxWorkers ? { AGX_DAEMON_MAX_CONCURRENT: String(options.maxWorkers) } : {}),
    }
  });

  daemon.unref();
  fs.writeFileSync(DAEMON_PID_FILE, String(daemon.pid));

  console.log(`${c.green}✓${c.reset} Daemon started (pid ${daemon.pid})`);
  console.log(`${c.dim}  Logs: ${DAEMON_LOG_FILE}${c.reset}`);
  console.log(`${c.dim}  Execution workers: ${options.maxWorkers || 1}${c.reset}`);
  console.log(`${c.dim}  Configure workers: agx daemon start -w 4${c.reset}`);
  console.log(`${c.dim}  Run in foreground: agx daemon${c.reset}`);

  return daemon.pid;
}

async function stopDaemon() {
  const pid = isDaemonRunning();
  if (!pid) {
    console.log(`${c.yellow}Daemon not running${c.reset}`);
    return false;
  }

  try {
    const stopped = await stopDaemonProcessTree(pid);
    if (fs.existsSync(DAEMON_PID_FILE)) {
      fs.unlinkSync(DAEMON_PID_FILE);
    }
    if (!stopped) {
      console.error(`${c.red}Failed to stop daemon process tree:${c.reset} pid ${pid} is still running`);
      return false;
    }
    console.log(`${c.green}✓${c.reset} Daemon stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop daemon:${c.reset} ${err.message}`);
    return false;
  }
}

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch { }
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
    ollama: commandExists('ollama'),
    codex: commandExists('codex')
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
  console.log(`  ${c.cyan}codex${c.reset}   │ OpenAI Codex CLI       │ ${status(providers.codex)}`);
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
  },
  codex: {
    name: 'Codex CLI',
    installCmd: 'npm install -g @openai/codex',
    description: 'OpenAI Codex CLI'
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
      console.log(`  ${c.cyan}1${c.reset}) glm-4.7:cloud ${c.dim}(?) - Recommended default${c.reset}`);
      console.log(`  ${c.cyan}2${c.reset}) qwen3:8b      ${c.dim}(4.9 GB) - Great all-rounder${c.reset}`);
      console.log(`  ${c.cyan}3${c.reset}) codellama:7b  ${c.dim}(3.8 GB) - Code specialist${c.reset}`);
      console.log(`  ${c.cyan}4${c.reset}) mistral:7b    ${c.dim}(4.1 GB) - Good general model${c.reset}`);
      console.log(`  ${c.cyan}5${c.reset}) Skip for now`);

      const choice = await prompt(`\nWhich model to pull? [1]: `);
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

  ${c.dim}# Cloud mode (recommended for autonomous tasks)${c.reset}
  ${c.cyan}agx login${c.reset}

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
      const missing = ['claude', 'gemini', 'ollama', 'codex'].filter(p => !providers[p]);
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
  let menuState = 'main'; // 'main', 'action', 'daemon'
  let selectedIdx = 0;
  let selectedProvider = null;

  // Build main menu items
  const buildMainMenu = () => {
    const items = [];

    // Add available providers
    if (providers.claude) {
      items.push({ id: 'claude', label: 'claude', desc: 'Anthropic Claude Code', type: 'provider' });
    }
    if (providers.codex) {
      items.push({ id: 'codex', label: 'codex', desc: 'OpenAI Codex', type: 'provider' });
    }
    if (providers.gemini) {
      items.push({ id: 'gemini', label: 'gemini', desc: 'Google Gemini', type: 'provider' });
    }
    if (providers.ollama) {
      items.push({ id: 'ollama', label: 'ollama', desc: 'Local Ollama', type: 'provider' });
    }

    // Separator and other options
    items.push({ id: 'sep1', type: 'separator' });

    items.push({ id: 'daemon', label: 'Daemon', desc: 'Background task runner', type: 'action' });

    return items;
  };

  // Build action menu (after selecting provider)
  const buildActionMenu = () => [
    { id: 'chat', label: 'Chat', desc: 'Start interactive conversation', type: 'action' },
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
          // Ollama now routes through Claude CLI
          cmd = 'claude';
          const ollamaModel = config?.ollama?.model || 'llama3.2:3b';
          args = ['--dangerously-skip-permissions', '--model', ollamaModel];
          const child = spawn(cmd, args, {
            stdio: 'inherit',
            env: {
              ...process.env,
              ANTHROPIC_AUTH_TOKEN: 'ollama',
              ANTHROPIC_BASE_URL: 'http://localhost:11434',
              ANTHROPIC_API_KEY: ''
            }
          });
          child.on('close', (code) => process.exit(code || 0));
        } else {
          cmd = selectedProvider;
          args = [];
          const child = spawn(cmd, args, { stdio: 'inherit' });
          child.on('close', (code) => process.exit(code || 0));
        }
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
        await stopDaemon();
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
        console.log(`  ${c.cyan}0${c.reset}) Back\n`);
        const actionChoice = await prompt('Choice: ');
        if (actionChoice === '0') {
          // Back - re-run menu
          spawn(process.argv[0], [process.argv[1]], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          return;
        } else if (actionChoice === '1') {
          let cmd = item.id;
          if (item.id === 'ollama') {
            // Ollama now routes through Claude CLI
            const ollamaModel = config?.ollama?.model || 'llama3.2:3b';
            spawn('claude', ['--dangerously-skip-permissions', '--model', ollamaModel], {
              stdio: 'inherit',
              env: {
                ...process.env,
                ANTHROPIC_AUTH_TOKEN: 'ollama',
                ANTHROPIC_BASE_URL: 'http://localhost:11434',
                ANTHROPIC_API_KEY: ''
              }
            }).on('close', (code) => process.exit(code || 0));
          } else {
            spawn(cmd, [], { stdio: 'inherit' }).on('close', (code) => process.exit(code || 0));
          }
        }
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

  // ============================================================
  // CLOUD STATE HELPERS
  // ============================================================

  const CLOUD_CONFIG_FILE = path.join(CONFIG_DIR, 'cloud.json');

  function loadCloudConfig() {
    logRetryFlow('loadCloudConfig', 'input', `path=${CLOUD_CONFIG_FILE}`);
    try {
      if (fs.existsSync(CLOUD_CONFIG_FILE)) {
        logRetryFlow('loadCloudConfig', 'processing', 'file exists');
        const raw = fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8');
        const config = JSON.parse(raw);
        logRetryFlow('loadCloudConfig', 'output', 'config loaded');
        return config;
      }
      logRetryFlow('loadCloudConfig', 'output', 'file missing');
    } catch (err) {
      logRetryFlow('loadCloudConfig', 'output', `error ${err?.message || err}`);
    }
    return null;
  }

  const TASK_CACHE_FILE = path.join(CONFIG_DIR, 'task-cache.json');

  function saveTaskCache(tasks) {
    try {
      if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const payload = {
        savedAt: new Date().toISOString(),
        tasks: tasks.map(t => ({
          id: t.id,
          slug: t.slug,
          title: t.title,
          stage: t.stage,
          status: t.status,
          engine: t.engine,
          provider: t.provider,
          model: t.model,
          swarm: t.swarm,
        })),
      };
      fs.writeFileSync(TASK_CACHE_FILE, JSON.stringify(payload, null, 2));
    } catch { }
  }

  function loadTaskCache() {
    try {
      if (fs.existsSync(TASK_CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(TASK_CACHE_FILE, 'utf8'));
      }
    } catch { }
    return null;
  }

  function saveCloudConfig(config) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CLOUD_CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  async function tryRefreshCloudToken(config) {
    if (!config?.apiUrl || !config?.refreshToken) return null;

    const refreshUrl = `${config.apiUrl}/api/auth/refresh`;
    logRetryFlow('cloudRequest', 'processing', `refresh token via ${refreshUrl}`);

    try {
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: config.refreshToken }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch { }

      if (!response.ok || !data?.access_token) {
        logRetryFlow('cloudRequest', 'output', `refresh failed HTTP ${response.status}`);
        return null;
      }

      const updated = {
        ...config,
        token: data.access_token,
        refreshToken: data.refresh_token || config.refreshToken,
      };
      saveCloudConfig(updated);
      logRetryFlow('cloudRequest', 'output', 'token refreshed');
      return updated;
    } catch (err) {
      logRetryFlow('cloudRequest', 'output', `refresh exception ${err?.message || err}`);
      return null;
    }
  }

  async function cloudRequest(method, endpoint, body = null) {
    logRetryFlow('cloudRequest', 'input', `method=${method}, endpoint=${endpoint}, body=${body ? JSON.stringify(body) : 'none'}`);
    const config = loadCloudConfig();
    if (!config?.apiUrl || !config?.token) {
      const errMsg = 'Not logged in to cloud. Run: agx login';
      logRetryFlow('cloudRequest', 'output', errMsg);
      throw new Error(errMsg);
    }

    const url = `${config.apiUrl}${endpoint}`;
    logRetryFlow('cloudRequest', 'processing', `url=${url}`);
    try {
      const makeRequest = async (cfg) => {
        const options = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.token}`,
            'x-user-id': cfg.userId || '',
          },
        };
        if (body) options.body = JSON.stringify(body);
        const response = await fetch(url, options);
        let data = null;
        try {
          data = await response.json();
        } catch { }
        return { response, data };
      };

      let activeConfig = config;
      let { response, data } = await makeRequest(activeConfig);

      if (response.status === 401) {
        const refreshedConfig = await tryRefreshCloudToken(activeConfig);
        if (refreshedConfig?.token) {
          activeConfig = refreshedConfig;
          ({ response, data } = await makeRequest(activeConfig));
        }
      }

      if (!response.ok) {
        logRetryFlow('cloudRequest', 'output', `error HTTP ${response.status}`);
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      logRetryFlow('cloudRequest', 'output', `status=${response.status}`);
      return data;
    } catch (err) {
      logRetryFlow('cloudRequest', 'output', `exception ${err?.message || err}`);
      throw err;
    }
  }

  async function resolveTaskId(taskId) {
    logRetryFlow('resolveTaskId', 'input', `taskId=${taskId}`);
    let resolvedTaskId = taskId;
    const isNumber = /^\d+$/.test(taskId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);

    if (isNumber) {
      logRetryFlow('resolveTaskId', 'processing', 'numeric shorthand');
      const cache = loadTaskCache();
      const index = parseInt(taskId, 10) - 1;
      const cached = cache?.tasks?.[index];
      if (!cached?.id) {
        const errMsg = `No cached task for #${taskId}. Run: agx task ls`;
        logRetryFlow('resolveTaskId', 'output', errMsg);
        throw new Error(errMsg);
      }
      resolvedTaskId = cached.id;
      logRetryFlow('resolveTaskId', 'output', `resolved from cache ${resolvedTaskId}`);
      return resolvedTaskId;
    }

    if (!isUuid) {
      const normalizedInput = String(taskId || '').trim().toLowerCase();
      logRetryFlow('resolveTaskId', 'processing', `slug lookup: ${normalizedInput}`);

      // Prefer server-side exact slug resolution if available.
      try {
        const { task } = await cloudRequest('GET', `/api/tasks?slug=${encodeURIComponent(taskId)}`);
        if (task?.id) {
          resolvedTaskId = task.id;
          logRetryFlow('resolveTaskId', 'output', `resolved slug exact ${resolvedTaskId}`);
          return resolvedTaskId;
        }
      } catch (err) {
        logRetryFlow('resolveTaskId', 'processing', `exact slug lookup failed: ${err.message}`);
      }

      // Fallback for older/newer API variants: fetch task list and resolve locally.
      const listRes = await cloudRequest('GET', '/api/tasks');
      const tasks = Array.isArray(listRes?.tasks) ? listRes.tasks : [];
      if (!tasks.length) {
        throw new Error(`No tasks available while resolving "${taskId}"`);
      }

      const exact = tasks.find((t) => String(t?.slug || '').toLowerCase() === normalizedInput);
      if (exact?.id) {
        logRetryFlow('resolveTaskId', 'output', `resolved slug exact(list) ${exact.id}`);
        return exact.id;
      }

      const prefixMatches = tasks.filter((t) => String(t?.slug || '').toLowerCase().startsWith(normalizedInput));
      if (prefixMatches.length === 1 && prefixMatches[0]?.id) {
        logRetryFlow('resolveTaskId', 'output', `resolved slug prefix ${prefixMatches[0].id}`);
        return prefixMatches[0].id;
      }

      const idPrefixMatches = tasks.filter((t) => String(t?.id || '').toLowerCase().startsWith(normalizedInput));
      if (idPrefixMatches.length === 1 && idPrefixMatches[0]?.id) {
        logRetryFlow('resolveTaskId', 'output', `resolved id prefix ${idPrefixMatches[0].id}`);
        return idPrefixMatches[0].id;
      }

      if (prefixMatches.length > 1) {
        const choices = prefixMatches.slice(0, 5).map((t) => `${t.slug || t.id}`).join(', ');
        throw new Error(`Ambiguous task "${taskId}" (matches: ${choices}). Use full slug or task ID.`);
      }

      throw new Error(`Task not found for "${taskId}". Run: agx task ls`);
    }

    logRetryFlow('resolveTaskId', 'processing', 'uuid shortcut');
    logRetryFlow('resolveTaskId', 'output', `using uuid ${resolvedTaskId}`);
    return resolvedTaskId;
  }

  function getOrchestrator() {
    const config = loadCloudConfig();
    if (!config?.apiUrl || !config?.token) {
      throw new Error('Not logged in to cloud. Run: agx login');
    }
    return createOrchestrator(config);
  }

  async function streamTaskLogs(taskId) {
    const config = loadCloudConfig();
    if (!config?.apiUrl || !config?.token) return () => { };

    const eventsourcePkg = require('eventsource');
    const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log' && data.log?.task_id === taskId) {
          const time = new Date().toLocaleTimeString();
          console.log(`${c.dim}[${time}]${c.reset} ${data.log.content}`);
        }
      } catch { }
    };

    es.onerror = () => { };
    return () => es.close();
  }

  async function waitForTaskTerminal(taskId, { follow = true } = {}) {
    const stopStream = follow ? await streamTaskLogs(taskId) : () => { };
    try {
      while (true) {
        const { task } = await cloudRequest('GET', `/api/tasks/${taskId}`);
        const status = String(task?.status || '').toLowerCase();
        if (status === 'completed' || status === 'failed' || status === 'blocked') {
          return task;
        }
        await sleep(2000);
      }
    } finally {
      stopStream();
    }
  }

  async function startTemporalTaskRun(rawTaskId, options = {}) {
    const { resetFirst = false, follow = true, nudge = null, forceSwarm = false } = options;
    const taskId = await resolveTaskId(rawTaskId);
    const orchestrator = getOrchestrator();

    if (resetFirst) {
      await cloudRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'queued',
        started_at: null,
        completed_at: null,
      });
    }

    await orchestrator.startTask(taskId, { forceSwarm });
    if (nudge) {
      await orchestrator.signalTask(taskId, 'nudge', { message: nudge });
    }

    console.log(`${c.green}✓${c.reset} Temporal workflow started`);
    console.log(`${c.dim}Task: ${taskId}${c.reset}`);

    const task = await waitForTaskTerminal(taskId, { follow });
    const finalStatus = String(task?.status || 'unknown');
    console.log(`\n${c.bold}Final status:${c.reset} ${finalStatus}`);
    return finalStatus === 'failed' ? 1 : 0;
  }

  function normalizeDaemonDecision(decision, fallbackSummary = '') {
    const allowed = new Set(['done', 'blocked', 'not_done', 'failed']);
    const extractedDecision = typeof decision?.decision === 'string' ? decision.decision.trim() : '';
    const normalizedDecision = allowed.has(extractedDecision) ? extractedDecision : 'failed';

    const explanation = typeof decision?.explanation === 'string' && decision.explanation.trim()
      ? decision.explanation.trim()
      : fallbackSummary || `Daemon decision: ${normalizedDecision}`;
    const finalResult = typeof decision?.final_result === 'string' && decision.final_result.trim()
      ? decision.final_result.trim()
      : explanation;
    const summary = typeof decision?.summary === 'string' && decision.summary.trim()
      ? decision.summary.trim()
      : '';

    return {
      decision: normalizedDecision,
      explanation,
      final_result: finalResult,
      summary,
    };
  }

  async function runCloudDaemonTask(task) {
    const taskId = String(task?.id || '').trim();
    if (!taskId) {
      throw new Error('Queue returned task without id');
    }

    const provider = String(task?.provider || task?.engine || 'claude').toLowerCase();
    const model = typeof task?.model === 'string' && task.model.trim() ? task.model.trim() : null;
    const logger = createTaskLogger(taskId);

    logger.log('system', `[daemon] picked task ${taskId} (${task?.stage || 'unknown'})\n`);
    console.log(`${c.dim}[daemon] picked ${taskId} (${task?.stage || 'unknown'}) via ${provider}${model ? `/${model}` : ''}${c.reset}`);

    let decisionPayload;
    try {
      if (task?.swarm) {
        const swarmResult = await runSwarmLoop({ taskId, task });
        decisionPayload = normalizeDaemonDecision(
          swarmResult?.decision,
          swarmResult?.code === 0 ? 'Swarm execution completed.' : 'Swarm execution failed.'
        );
      } else {
        const singleResult = await runSingleAgentLoop({
          taskId,
          task,
          provider,
          model,
          logger,
        });
        decisionPayload = normalizeDaemonDecision(
          singleResult?.decision,
          singleResult?.code === 0 ? 'Single-agent execution completed.' : 'Single-agent execution failed.'
        );
      }
    } catch (err) {
      const message = err?.message || 'Daemon execution failed.';
      decisionPayload = {
        decision: 'failed',
        explanation: message,
        final_result: message,
        summary: message,
      };
      logger.log('error', `[daemon] execution failed: ${message}\n`);
    } finally {
      await logger.flushAll();
    }

    await cloudRequest('POST', '/api/queue/complete', {
      taskId,
      log: decisionPayload.summary || decisionPayload.explanation,
      decision: decisionPayload.decision,
      final_result: decisionPayload.final_result,
      explanation: decisionPayload.explanation,
    });

    console.log(`${c.dim}[daemon] completed ${taskId} → ${decisionPayload.decision}${c.reset}`);
  }

  async function runCloudDaemonLoop(options = {}) {
    const configured = Number(
      options.maxWorkers
      || process.env.AGX_DAEMON_MAX_CONCURRENT
      || 1
    );
    const maxWorkers = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1;
    const pollMsRaw = Number(process.env.AGX_DAEMON_POLL_MS || 1500);
    const pollMs = Number.isFinite(pollMsRaw) && pollMsRaw >= 200 ? pollMsRaw : 1500;

    const inFlight = new Map();
    let stopping = false;

    const requestStop = () => {
      if (stopping) return;
      stopping = true;
      console.log(`\n${c.dim}[daemon] stopping... waiting for ${inFlight.size} active task(s)${c.reset}`);
    };

    process.on('SIGINT', requestStop);
    process.on('SIGTERM', requestStop);

    console.log(`${c.green}✓${c.reset} Daemon loop started (workers=${maxWorkers}, poll=${pollMs}ms)`);

    while (!stopping) {
      try {
        while (!stopping && inFlight.size < maxWorkers) {
          const queue = await cloudRequest('GET', '/api/queue');
          const task = queue?.task || null;
          if (!task) break;

          const taskId = String(task.id || '');
          if (!taskId || inFlight.has(taskId)) {
            break;
          }

          const execution = runCloudDaemonTask(task)
            .catch((err) => {
              console.error(`${c.red}[daemon] task ${taskId} failed:${c.reset} ${err?.message || err}`);
            })
            .finally(() => {
              inFlight.delete(taskId);
            });

          inFlight.set(taskId, execution);
        }
      } catch (err) {
        console.error(`${c.red}[daemon] queue poll failed:${c.reset} ${err?.message || err}`);
      }

      if (!stopping) {
        await sleep(pollMs);
      }
    }

    if (inFlight.size > 0) {
      await Promise.allSettled(Array.from(inFlight.values()));
    }
  }

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

  // Status command
  if (cmd === 'status') {
    if (args.includes('--cloud')) {
      console.log(`${c.yellow}Note:${c.reset} ${c.cyan}--cloud${c.reset} is no longer needed. Cloud is the default.`);
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
  // - Cloud API is the STORAGE layer
  // ============================================================

  // Provider aliases for convenience
  const PROVIDER_ALIASES = {
    'c': 'claude', 'cl': 'claude', 'claude': 'claude',
    'x': 'codex', 'codex': 'codex',
    'g': 'gemini', 'gem': 'gemini', 'gemini': 'gemini',
    'o': 'ollama', 'ol': 'ollama', 'ollama': 'ollama'
  };

  // ============================================================
  // agx new "<goal>" [--provider c|g|o|x] [--run] [--json]
  // Creates a new task via cloud API
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
          console.log(`${c.dim}Valid: c/claude, g/gemini, o/ollama, x/codex${c.reset}`);
        }
        process.exit(1);
      }
    }

    // Parse --model / -m
    let model = null;
    const modelIdx = args.findIndex(a => a === '--model' || a === '-m');
    if (modelIdx !== -1 && args[modelIdx + 1]) {
      model = args[modelIdx + 1];
    }
    let ticketType = null;
    const ticketTypeIdx = args.findIndex(a => a === '--type' || a === '--ticket-type');
    if (ticketTypeIdx !== -1 && args[ticketTypeIdx + 1]) {
      const resolvedType = normalizeTicketType(args[ticketTypeIdx + 1]);
      ticketType = resolvedType === 'spike' ? 'spike' : 'task';
    }

    // Default provider from config
    if (!provider) {
      const config = loadConfig();
      provider = config?.defaultProvider || 'claude';
    }

    // Extract goal text (filter out flags)
    const flagsToRemove = ['--json', '--run', '-r', '--provider', '-P', '--model', '-m', '--type', '--ticket-type'];
    const goalParts = [];
    for (let i = 1; i < args.length; i++) {
      if (flagsToRemove.includes(args[i])) {
        if (args[i] === '--provider' || args[i] === '-P') i++;
        if (args[i] === '--model' || args[i] === '-m') i++;
        if (args[i] === '--type' || args[i] === '--ticket-type') i++;
        continue;
      }
      goalParts.push(args[i]);
    }
    const goalText = goalParts.join(' ');

    if (!goalText) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'missing_goal', usage: 'agx new "<goal>" [--provider c] [--type spike|task] [--run]' }));
      } else {
        console.log(`${c.red}Usage:${c.reset} agx new "<goal>" [--provider c|g|o|x] [--type spike|task] [--run]`);
      }
      process.exit(1);
    }

    try {
      // Create task via cloud API
      const frontmatter = ['status: queued', 'stage: ideation'];
      frontmatter.push(`engine: ${provider}`);
      frontmatter.push(`provider: ${provider}`);
      if (model) frontmatter.push(`model: ${model}`);
      if (ticketType) frontmatter.push(`type: ${ticketType}`);

      const content = `---\n${frontmatter.join('\n')}\n---\n\n# ${goalText}\n`;

      const { task } = await cloudRequest('POST', '/api/tasks', { content });
      console.log(`${c.green}✓${c.reset} Task created in cloud`);
      if (task?.id) {
        console.log(`${c.dim}Task ID: ${task.id}${c.reset}`);
      }

      if (!runAfter) {
        console.log(`\n${c.dim}Task: ${goalText}${c.reset}`);
        console.log(`${c.dim}Provider: ${provider}${c.reset}`);
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

  // ============================================================
  // TASK MANAGEMENT
  // ============================================================

  // Helper: get task logs from per-task log file
  function getTaskLogs(taskName, limit = 20) {
    const logPath = getTaskLogPath(taskName);
    if (!fs.existsSync(logPath)) return [];
    try {
      const logs = fs.readFileSync(logPath, 'utf8');
      return logs.split('\n').slice(-limit);
    } catch { return []; }
  }

  // Daemon commands
  if (cmd === 'daemon') {
    const daemonArgs = args.slice(1);
    const subcmd = daemonArgs[0] && !daemonArgs[0].startsWith('-') ? daemonArgs[0] : undefined;
    const wantsHelp = args.includes('--help') || args.includes('-h') || subcmd === 'help';
    const workersFlagIdx = args.findIndex((arg) => arg === '-w' || arg === '--workers' || arg === '--max-workers');
    let maxWorkers;
    if (workersFlagIdx !== -1) {
      const raw = args[workersFlagIdx + 1];
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.log(`${c.red}Invalid worker count:${c.reset} ${raw || '(missing)'}`);
        console.log(`${c.dim}Use a positive integer, e.g. -w 4${c.reset}`);
        process.exit(1);
      }
      maxWorkers = parsed;
    }

    const daemonOptions = {
      maxWorkers,
    };

    if (wantsHelp) {
      console.log(`${c.bold}agx daemon${c.reset} - Local cloud worker\n`);
      console.log(`  agx daemon            Run local daemon loop in foreground`);
      console.log(`  agx daemon start      Start local daemon loop in background`);
      console.log(`  agx daemon stop       Stop background worker`);
      console.log(`  agx daemon status     Check if running`);
      console.log(`  agx daemon logs       Show recent logs`);
      console.log(`  agx daemon tail       Live tail daemon logs`);
      console.log(`  agx daemon -w, --workers <n>  Execution worker count (default: 1)`);
      process.exit(0);
    }

    if (!subcmd || subcmd === 'run' || subcmd === '--run') {
      const cloudConfig = loadCloudConfig();
      if (!cloudConfig?.apiUrl || !cloudConfig?.token) {
        console.log(`${c.red}Not connected to cloud.${c.reset} Run: agx login`);
        process.exit(1);
      }

      await runCloudDaemonLoop(daemonOptions);
      return true;
    }

    if (subcmd === 'start') {
      startDaemon(daemonOptions);
      process.exit(0);
    } else if (subcmd === 'stop') {
      await stopDaemon();
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
    } else if (subcmd === 'tail') {
      if (!fs.existsSync(DAEMON_LOG_FILE)) {
        console.log(`${c.dim}No logs yet. Start daemon with: agx daemon start${c.reset}`);
        process.exit(0);
      }
      console.log(`${c.dim}Tailing ${DAEMON_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
      const tail = spawn('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit' });
      tail.on('close', () => process.exit(0));
      return true;
    } else {
      console.log(`${c.red}Unknown daemon command:${c.reset} ${subcmd}`);
      console.log(`${c.dim}Run: agx daemon --help${c.reset}`);
      process.exit(0);
    }
    return true;
  }

  // ============================================================
  // CLOUD COMMANDS - Sync with agx-cloud
  // ============================================================

  // ============================================================
  // DIRECT COMMANDS - No 'cloud' prefix needed
  // ============================================================

  // agx login [url]
  if (cmd === 'login') {
    const cloudUrl = args[1] || 'http://localhost:3000';
    console.log(`${c.cyan}→${c.reset} Connecting to AGX Cloud...`);
    console.log(`${c.dim}Cloud URL: ${cloudUrl}${c.reset}\n`);

    try {
      // 1. Request Device Code
      const deviceRes = await fetch(`${cloudUrl}/api/auth/device/code`, { method: 'POST' });
      if (!deviceRes.ok) {
        let detail = deviceRes.statusText || '';
        try {
          const payload = await deviceRes.json();
          detail = payload?.error || payload?.message || detail;
        } catch {
          try {
            const text = await deviceRes.text();
            if (text) detail = text;
          } catch { }
        }
        throw new Error(`Failed to init device flow: ${detail || `HTTP ${deviceRes.status}`}`);
      }
      const deviceData = await deviceRes.json();

      console.log(`${c.bold}First, configure your device:${c.reset}`);
      console.log(`\n  ${c.cyan}${c.bold}${deviceData.user_code}${c.reset}\n`);
      console.log(`Open this URL in your browser:\n  ${c.blue}${deviceData.verification_uri}${c.reset}\n`);

      // Try to open browser automatically
      try {
        if (process.platform === 'darwin') execSync(`open "${deviceData.verification_uri_complete || deviceData.verification_uri}"`);
        else if (process.platform === 'linux') execSync(`xdg-open "${deviceData.verification_uri_complete || deviceData.verification_uri}"`);
        else if (process.platform === 'win32') execSync(`start "${deviceData.verification_uri_complete || deviceData.verification_uri}"`);
      } catch { /* ignore */ }

      // 2. Poll for token
      process.stdout.write('Waiting for approval...');

      const interval = (deviceData.interval || 5) * 1000;
      let tokenData = null;

      while (!tokenData) {
        await new Promise(r => setTimeout(r, interval));

        const pollRes = await fetch(`${cloudUrl}/api/auth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceData.device_code })
        });

        const data = await pollRes.json();

        if (pollRes.ok && data.access_token) {
          tokenData = data;
          process.stdout.write(`\n${c.green}✓${c.reset} Approved!\n`);
          break;
        }

        if (data.error === 'authorization_pending') {
          process.stdout.write('.');
          continue;
        }

        if (data.error === 'slow_down') {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        if (data.error === 'expired_token') {
          console.log(`\n${c.red}✗${c.reset} Code expired. Please try again.`);
          process.exit(1);
        }

        if (data.error === 'access_denied') {
          console.log(`\n${c.red}✗${c.reset} Access denied.`);
          process.exit(1);
        }

        console.log(`\n${c.red}✗${c.reset} Error: ${data.error}`);
        console.log(`\n${c.red}✗${c.reset} Failed to connect: ${err.message}`);
        process.exit(1);
      }

      // 3. Save Config
      const config = {
        apiUrl: cloudUrl.replace(/\/$/, ''),
        token: tokenData.access_token,
        refreshToken: tokenData.refresh_token
      };

      saveCloudConfig(config);

      // Get user details
      const authRes = await fetch(`${config.apiUrl}/api/auth/status`, {
        headers: { 'Authorization': `Bearer ${config.token}` }
      });

      if (authRes.ok) {
        const auth = await authRes.json();
        if (auth.user) {
          config.userId = auth.user.id;
          config.userName = auth.user.name || auth.user.email;
          saveCloudConfig(config);
          console.log(`${c.green}✓${c.reset} Logged in as ${c.bold}${config.userName}${c.reset}`);
        }
      }

      // Generate daemon secret
      console.log(`\n${c.cyan}→${c.reset} Setting up daemon security...`);

      const { setupDaemonSecret, loadSecurityConfig } = require('./lib/security');
      const existingConfig = loadSecurityConfig();

      if (existingConfig?.daemonSecret) {
        console.log(`${c.green}✓${c.reset} Using existing daemon secret`);
        console.log(`${c.dim}  Run 'agx security rotate' only when you intentionally want to invalidate pending signed tasks${c.reset}`);
      } else {
        const { secret, isNew } = await setupDaemonSecret({
          cloudApiUrl: config.apiUrl,
          cloudToken: config.token,
        });
        console.log(`${c.green}✓${c.reset} Daemon secret generated`);
        console.log(`${c.dim}  Secret stored in ~/.agx/security.json${c.reset}`);
      }

      console.log(`\n${c.green}Setup complete!${c.reset}`);
      console.log(`${c.dim}Run: agx daemon start${c.reset}`);
    } catch (err) {
      console.log(`\n${c.red}✗${c.reset} Failed to connect: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx logout
  if (cmd === 'logout') {
    if (fs.existsSync(CLOUD_CONFIG_FILE)) {
      fs.unlinkSync(CLOUD_CONFIG_FILE);
    }
    console.log(`${c.green}✓${c.reset} Logged out from cloud`);
    process.exit(0);
  }

  // agx status
  if (cmd === 'status') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.yellow}Not connected to cloud${c.reset}`);
      console.log(`${c.dim}Run: agx login [url]${c.reset}`);
      process.exit(0);
    }
    console.log(`${c.bold}Cloud Status${c.reset}\n`);
    console.log(`  URL:  ${config.apiUrl}`);
    console.log(`  User: ${config.userName || '(anonymous)'}`);

    // Fetch queue status
    try {
      const { tasks } = await cloudRequest('GET', '/api/tasks');
      const queued = tasks.filter(t => t.status === 'queued').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      console.log(`\n  Tasks: ${tasks.length} total (${queued} queued, ${inProgress} in progress)`);
    } catch (err) {
      console.log(`\n  ${c.yellow}Could not fetch tasks:${c.reset} ${err.message}`);
    }
    process.exit(0);
  }

  // agx new "<task description>" [--project <name>] [--priority <n>] [--engine <name>]
  if (cmd === 'new' || cmd === 'push') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    // Parse flags
    let project = null, priority = null, engine = null, provider = null, model = null, ticketType = null;
    const taskParts = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--project' || args[i] === '-p') {
        project = args[++i];
      } else if (args[i] === '--priority' || args[i] === '-P') {
        priority = parseInt(args[++i]);
      } else if (args[i] === '--engine' || args[i] === '-e') {
        engine = args[++i];
      } else if (args[i] === '--provider') {
        provider = args[++i];
      } else if (args[i] === '--model' || args[i] === '-m') {
        model = args[++i];
      } else if (args[i] === '--type' || args[i] === '--ticket-type') {
        ticketType = normalizeTicketType(args[++i]);
      } else {
        taskParts.push(args[i]);
      }
    }

    const taskDesc = taskParts.join(' ');
    if (!taskDesc) {
      console.log(`${c.yellow}Usage:${c.reset} agx new "<task>" [--project name] [--priority n] [--engine claude|gemini|ollama|codex] [--type spike|task]`);
      process.exit(1);
    }

    // Build markdown content
    const frontmatter = ['status: queued', 'stage: ideation'];
    if (project) frontmatter.push(`project: ${project}`);
    if (priority) frontmatter.push(`priority: ${priority}`);
    if (engine) frontmatter.push(`engine: ${engine}`);
    if (provider) frontmatter.push(`provider: ${provider}`);
    if (model) frontmatter.push(`model: ${model}`);
    if (ticketType) frontmatter.push(`type: ${ticketType}`);
    if (!engine && provider) frontmatter.push(`engine: ${provider}`);

    const content = `---\n${frontmatter.join('\n')}\n---\n\n# ${taskDesc}\n`;

    try {
      const { task } = await cloudRequest('POST', '/api/tasks', { content });
      console.log(`${c.green}✓${c.reset} Task created`);
      console.log(`  ID: ${task.id}`);
      console.log(`  Stage: ${task.stage || 'ideation'}`);
      if (project) console.log(`  Project: ${project}`);
      console.log(`${c.dim}Use: agx ${task.engine || engine || 'claude'} --cloud-task ${task.id}${c.reset}`);
    } catch (err) {
      const message = err?.message || String(err);
      console.log(`${c.red}✗${c.reset} Failed: ${message}`);
      try {
        if (logger) {
          logger.log('error', `[run] failed: ${message}\n`);
          await logger.flushAll();
        }
      } catch { }
      try {
        await patchTaskState(resolvedTaskId, { status: 'failed', completed_at: new Date().toISOString() });
      } catch { }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx run <taskId>  (claim task and execute without changing stage)
  // agx task run <taskId>  (Docker-style namespace alias)
  if (cmd === 'run' || (cmd === 'task' && args[1] === 'run')) {
    const runArgs = cmd === 'task' ? args.slice(1) : args;
    let taskId = null;
    let forceSwarm = false;
    for (let i = 1; i < runArgs.length; i++) {
      if (runArgs[i] === '--task' || runArgs[i] === '-t') {
        taskId = runArgs[++i];
      } else if (runArgs[i] === '--swarm') {
        forceSwarm = true;
      }
    }
    if (!taskId) {
      taskId = runArgs.slice(1).find(a => !a.startsWith('-'));
    }
    if (!taskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx run <taskId> [--task <id>] [--swarm]`);
      console.log(`${c.dim}   or:${c.reset} agx task run <taskId> [--task <id>] [--swarm]`);
      process.exit(1);
    }

    try {
      const exitCode = await startTemporalTaskRun(taskId, { forceSwarm, follow: true });
      process.exit(exitCode);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
  }

  // agx task reset <taskId>
  if (cmd === 'reset' || (cmd === 'task' && args[1] === 'reset')) {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const runArgs = cmd === 'task' ? args.slice(1) : args;
    let taskId = null;
    for (let i = 1; i < runArgs.length; i++) {
      if (runArgs[i] === '--task' || runArgs[i] === '-t') {
        taskId = runArgs[++i];
      }
    }
    if (!taskId) {
      taskId = runArgs.slice(1).find(a => !a.startsWith('-'));
    }
    if (!taskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx task reset <taskId> [--task <id>]`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(taskId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, {
        status: 'queued',
        started_at: null,
        completed_at: null,
      });
      const { task: refreshedTask } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}`);
      const isQueued = refreshedTask?.status === 'queued';
      const timestampsCleared = !refreshedTask?.started_at && !refreshedTask?.completed_at;

      if (!isQueued || !timestampsCleared) {
        throw new Error(
          `Reset verification failed (status=${refreshedTask?.status || 'unknown'}, ` +
          `started_at=${refreshedTask?.started_at || 'null'}, ` +
          `completed_at=${refreshedTask?.completed_at || 'null'})`
        );
      }

      console.log(`${c.green}✓${c.reset} Task reset to queued`);
      console.log(`${c.dim}  ID: ${resolvedTaskId}${c.reset}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx retry <taskId> [--task <id>] [--swarm]
  if (cmd === 'retry' || (cmd === 'task' && args[1] === 'retry')) {
    const runArgs = cmd === 'task' ? args.slice(1) : args;
    retryFlowActive = true;
    logRetryFlow('retry command', 'input', `cmd=${cmd}, args=${runArgs.slice(1).join(' ')}`);
    let taskId = null;
    let forceSwarm = false;
    for (let i = 1; i < runArgs.length; i++) {
      if (runArgs[i] === '--task' || runArgs[i] === '-t') {
        taskId = runArgs[++i];
      } else if (runArgs[i] === '--swarm') {
        forceSwarm = true;
      }
    }
    if (!taskId) {
      taskId = runArgs.slice(1).find(a => !a.startsWith('-'));
    }
    if (!taskId) {
      logRetryFlow('retry command', 'output', 'missing task id');
      console.log(`${c.yellow}Usage:${c.reset} agx retry <taskId> [--task <id>] [--swarm]`);
      console.log(`${c.dim}   or:${c.reset} agx task retry <taskId> [--task <id>] [--swarm]`);
      process.exit(1);
    }

    try {
      const exitCode = await startTemporalTaskRun(taskId, {
        resetFirst: true,
        forceSwarm,
        follow: true,
      });
      process.exit(exitCode);
    } catch (err) {
      logRetryFlow('retry command', 'output', `failed ${err.message}`);
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
  }

  // agx task ls [-a]  (Docker-style namespace)
  if ((cmd === 'task' && args[1] === 'ls') || cmd === 'list' || cmd === 'ls' || cmd === 'tasks') {
    const showAll = args.includes('-a') || args.includes('--all');
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    try {
      const { tasks } = await cloudRequest('GET', '/api/tasks');
      if (tasks.length === 0) {
        console.log(`${c.dim}No tasks in queue${c.reset}`);
        process.exit(0);
      }

      saveTaskCache(tasks);

      console.log(`${c.bold}Tasks${c.reset} (${tasks.length})\n`);
      let idx = 1;
      for (const task of tasks) {
        const statusIcon = {
          queued: c.yellow + '○' + c.reset,
          in_progress: c.blue + '●' + c.reset,
          completed: c.green + '✓' + c.reset,
          failed: c.red + '✗' + c.reset,
        }[task.status] || '?';

        console.log(`  ${c.dim}${idx}.${c.reset} ${statusIcon} ${task.slug || 'task'}`);
        const displayProvider = task.swarm
          ? (task.engine || task.provider || 'auto')
          : (task.provider || task.engine || 'auto');
        const displayModel = task.swarm
          ? (task.model || '')
          : (task.model || '');
        const modelSuffix = displayModel ? `/${displayModel}` : '';
        const swarmSuffix = task.swarm ? ' (swarm)' : '';
        console.log(`    ${c.dim}${task.stage || 'ideation'} · ${displayProvider}${modelSuffix}${swarmSuffix} · ${task.id.slice(0, 8)}${c.reset}`);
        idx++;
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx complete <taskId> [--log "message"]
  if (cmd === 'complete' || cmd === 'done') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    let taskId = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--task' || args[i] === '-t') {
        taskId = args[++i];
      }
    }
    if (!taskId) {
      taskId = args.slice(1).find(a => !a.startsWith('-'));
    }
    if (!taskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx complete <taskId> [--log "message"] [--task <id>]`);
      process.exit(1);
    }

    let log = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--log' || args[i] === '-l') {
        log = args[++i];
      }
    }

    try {
      const { task, newStage } = await cloudRequest('POST', '/api/queue/complete', {
        taskId,
        log: log || 'Stage completed via agx CLI',
      });
      console.log(`${c.green}✓${c.reset} Stage completed`);
      console.log(`  New stage: ${newStage}`);
      if (newStage === 'done') {
        console.log(`  ${c.green}Task is now complete!${c.reset}`);
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx watch - Real-time SSE stream
  if (cmd === 'watch') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    console.log(`${c.cyan}→${c.reset} Watching for task updates... (Ctrl+C to stop)\n`);

    // Use EventSource for SSE
    const eventsourcePkg = require('eventsource');
    const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    es.onopen = () => {
      console.log(`${c.green}✓${c.reset} Connected to stream`);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const timestamp = new Date().toLocaleTimeString();

        if (data.type === 'connected' || data.type === 'subscribed') {
          console.log(`${c.dim}[${timestamp}] ${data.type}${c.reset}`);
        } else if (data.type === 'heartbeat') {
          // Silent heartbeat
        } else if (data.type === 'log') {
          console.log(`${c.blue}[${timestamp}] LOG${c.reset} ${data.log?.content || '(empty)'}`);
        } else if (data.type === 'INSERT') {
          console.log(`${c.green}[${timestamp}] NEW${c.reset} ${data.task?.title || 'Untitled'} → ${data.task?.stage || 'ideation'}`);
        } else if (data.type === 'UPDATE') {
          console.log(`${c.yellow}[${timestamp}] UPD${c.reset} ${data.task?.title || 'Untitled'} → ${data.task?.stage || '?'} (${data.task?.status || '?'})`);
        } else if (data.type === 'DELETE') {
          console.log(`${c.red}[${timestamp}] DEL${c.reset} Task removed`);
        }
      } catch (err) {
        console.log(`${c.dim}[raw] ${event.data}${c.reset}`);
      }
    };

    es.onerror = (err) => {
      console.log(`${c.red}✗${c.reset} Stream error: ${err.message || 'Connection lost'}`);
      console.log(`${c.dim}Reconnecting...${c.reset}`);
    };

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log(`\n${c.dim}Closing stream...${c.reset}`);
      es.close();
      process.exit(0);
    });

    // Keep process alive
    return true;
  }

  // agx comments clear <taskId|slug|#>
  if (cmd === 'comments' && args[1] === 'clear') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx comments clear <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const data = await cloudRequest('DELETE', `/api/tasks/${resolvedTaskId}/history?target=comments`);
      console.log(`${c.green}✓${c.reset} Cleared task comments`);
      console.log(`  ID: ${resolvedTaskId}`);
      console.log(`  Comments deleted: ${data?.deleted?.comments ?? 0}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx logs clear <taskId|slug|#>
  if (cmd === 'logs' && args[1] === 'clear') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx logs clear <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const data = await cloudRequest('DELETE', `/api/tasks/${resolvedTaskId}/history?target=logs`);
      console.log(`${c.green}✓${c.reset} Cleared task logs`);
      console.log(`  ID: ${resolvedTaskId}`);
      console.log(`  Logs deleted: ${data?.deleted?.logs ?? 0}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx comments tail <taskId|slug|#>
  if (cmd === 'comments' && args[1] === 'ls') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx comments ls <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const { comments } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}/comments`);
      if (!Array.isArray(comments) || comments.length === 0) {
        console.log(`${c.dim}No comments yet${c.reset}`);
      } else {
        for (const comment of comments) {
          const time = comment.created_at ? new Date(comment.created_at).toLocaleString() : 'unknown-time';
          const author = comment.author_type || 'user';
          console.log(`${c.dim}[${time}]${c.reset} (${author}) ${comment.content || ''}`);
        }
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to fetch comments: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx comments tail <taskId|slug|#>
  if (cmd === 'comments' && args[1] === 'tail') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx comments tail <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    const seen = new Set();
    const printComments = async () => {
      const { comments } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}/comments`);
      if (!Array.isArray(comments)) return;
      for (const comment of comments) {
        if (!comment?.id || seen.has(comment.id)) continue;
        seen.add(comment.id);
        const time = comment.created_at ? new Date(comment.created_at).toLocaleString() : 'unknown-time';
        const author = comment.author_type || 'user';
        console.log(`${c.dim}[${time}]${c.reset} (${author}) ${comment.content || ''}`);
      }
    };

    try {
      await printComments();
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to fetch comments: ${err.message}`);
      process.exit(1);
    }

    console.log(`\n${c.cyan}→${c.reset} Tailing comments... (Ctrl+C to stop)\n`);
    const timer = setInterval(() => {
      printComments().catch(() => { });
    }, 2000);

    process.on('SIGINT', () => {
      clearInterval(timer);
      process.exit(0);
    });
    return true;
  }

  // agx logs tail <taskId|slug|#>
  if (cmd === 'logs' && args[1] === 'ls') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx logs ls <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const { logs } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}/logs`);
      if (!Array.isArray(logs) || logs.length === 0) {
        console.log(`${c.dim}No logs yet${c.reset}`);
      } else {
        for (const log of logs) {
          const time = log.created_at ? new Date(log.created_at).toLocaleString() : 'unknown-time';
          console.log(`${c.dim}[${time}]${c.reset} ${log.content || ''}`);
        }
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to fetch logs: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx logs tail <taskId|slug|#>
  if (cmd === 'logs' && args[1] === 'tail') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx logs tail <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const { logs } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}/logs`);
      if (Array.isArray(logs)) {
        for (const log of logs) {
          const time = log.created_at ? new Date(log.created_at).toLocaleString() : 'unknown-time';
          console.log(`${c.dim}[${time}]${c.reset} ${log.content || ''}`);
        }
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to fetch logs: ${err.message}`);
      process.exit(1);
    }

    console.log(`\n${c.cyan}→${c.reset} Tailing logs... (Ctrl+C to stop)\n`);
    const eventsourcePkg = require('eventsource');
    const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log' && data.log?.task_id === resolvedTaskId) {
          const time = new Date().toLocaleTimeString();
          console.log(`${c.dim}[${time}]${c.reset} ${data.log.content}`);
        }
      } catch { }
    };

    es.onerror = () => {
      console.log(`${c.dim}Reconnecting...${c.reset}`);
    };

    process.on('SIGINT', () => {
      es.close();
      process.exit(0);
    });
    return true;
  }

  // agx task logs <taskId> [--follow]
  // agx task tail <taskId> (alias for logs --follow)
  if ((cmd === 'task' && (args[1] === 'logs' || args[1] === 'tail')) || (cmd === 'logs' && args[1] !== 'tail' && args[1] !== 'clear')) {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    // Adjust args for task namespace
    const logArgs = cmd === 'task' ? args.slice(2) : args.slice(1);
    const isTaskTailAlias = cmd === 'task' && args[1] === 'tail';
    const follow = isTaskTailAlias || logArgs.includes('--follow') || logArgs.includes('-f');
    let taskId = null;
    for (let i = 0; i < logArgs.length; i++) {
      if (logArgs[i] === '--task' || logArgs[i] === '-t') {
        taskId = logArgs[++i];
      }
    }
    if (!taskId) {
      taskId = logArgs.find(a => !a.startsWith('-'));
    }

    if (!taskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx task logs <taskId> [--follow] [--task <id>]`);
      console.log(`${c.dim}   or:${c.reset} agx task tail <taskId> [--task <id>]`);
      process.exit(1);
    }

    // Fetch logs
    try {
      const { logs } = await cloudRequest('GET', `/api/tasks/${taskId}/logs`);

      if (logs.length === 0) {
        console.log(`${c.dim}No logs yet${c.reset}`);
      } else {
        console.log(`${c.bold}Task Logs${c.reset} (${logs.length})\n`);
        for (const log of logs) {
          const time = new Date(log.created_at).toLocaleString();
          console.log(`${c.dim}[${time}]${c.reset} ${log.content}`);
        }
      }

      // If --follow, switch to SSE mode
      if (follow) {
        console.log(`\n${c.cyan}→${c.reset} Tailing logs... (Ctrl+C to stop)\n`);

        const eventsourcePkg = require('eventsource');
        const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
        const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, {
          headers: { 'Authorization': `Bearer ${config.token}` },
        });

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'log' && data.log?.task_id === taskId) {
              const time = new Date().toLocaleTimeString();
              console.log(`${c.dim}[${time}]${c.reset} ${data.log.content}`);
            }
          } catch { }
        };

        es.onerror = () => {
          console.log(`${c.dim}Reconnecting...${c.reset}`);
        };

        process.on('SIGINT', () => {
          es.close();
          process.exit(0);
        });

        return true;
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to fetch logs: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx task stop <taskId> (Docker-style namespace)
  if (cmd === 'task' && args[1] === 'stop') {
    const rawTaskId = args[2];
    if (!rawTaskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx task stop <taskId>`);
      process.exit(1);
    }

    try {
      const taskId = await resolveTaskId(rawTaskId);
      const orchestrator = getOrchestrator();
      await orchestrator.signalTask(taskId, 'stop', { reason: 'Stopped from CLI' });
      console.log(`${c.green}✓${c.reset} Task stopped`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx task clear <taskId|slug|#> (clear comments and logs)
  if (cmd === 'task' && args[1] === 'clear') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const rawId = args[2];
    if (!rawId) {
      console.log(`${c.yellow}Usage:${c.reset} agx task clear <taskId|slug|#>`);
      process.exit(1);
    }

    let resolvedTaskId = null;
    try {
      resolvedTaskId = await resolveTaskId(rawId);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed to resolve task: ${err.message}`);
      process.exit(1);
    }

    try {
      const data = await cloudRequest('DELETE', `/api/tasks/${resolvedTaskId}/history`);
      console.log(`${c.green}✓${c.reset} Cleared task history`);
      console.log(`  ID: ${resolvedTaskId}`);
      console.log(`  Comments deleted: ${data?.deleted?.comments ?? 0}`);
      console.log(`  Logs deleted: ${data?.deleted?.logs ?? 0}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx task rm <taskId> (Docker-style namespace)
  if (cmd === 'task' && args[1] === 'rm') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
      process.exit(1);
    }

    const taskId = args[2];
    if (!taskId) {
      console.log(`${c.yellow}Usage:${c.reset} agx task rm <taskId>`);
      process.exit(1);
    }

    try {
      await cloudRequest('DELETE', `/api/tasks/${taskId}`);
      console.log(`${c.green}✓${c.reset} Task removed`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx container ls (Docker-style namespace - list running daemons)
  if (cmd === 'container' && args[1] === 'ls') {
    const { execSync } = require('child_process');
    try {
      const result = execSync('pgrep -fl "agx.*daemon" 2>/dev/null || echo ""', { encoding: 'utf8' });
      if (result.trim()) {
        console.log(`${c.bold}Running Containers${c.reset}\n`);
        console.log(result.trim());
      } else {
        console.log(`${c.dim}No running containers${c.reset}`);
      }
    } catch {
      console.log(`${c.dim}No running containers${c.reset}`);
    }
    process.exit(0);
  }

  // agx container logs [name] (Docker-style namespace - daemon logs)
  if (cmd === 'container' && args[1] === 'logs') {
    const containerName = args[2];
    const LOG_DIR = path.join(CONFIG_DIR, 'logs');

    try {
      if (containerName) {
        const logFile = path.join(LOG_DIR, `${containerName}.log`);
        if (fs.existsSync(logFile)) {
          const logs = fs.readFileSync(logFile, 'utf8');
          console.log(logs);
        } else {
          console.log(`${c.dim}No logs found for container: ${containerName}${c.reset}`);
        }
      } else {
        // Show all logs if no container specified
        if (!fs.existsSync(LOG_DIR)) {
          console.log(`${c.dim}No logs directory${c.reset}`);
          process.exit(0);
        }
        const logFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
        if (logFiles.length === 0) {
          console.log(`${c.dim}No logs found${c.reset}`);
          process.exit(0);
        }
        for (const file of logFiles) {
          console.log(`${c.bold}${file}${c.reset}`);
          const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
          console.log(content);
          console.log('');
        }
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx container stop (Docker-style namespace - stop daemon)
  if (cmd === 'container' && args[1] === 'stop') {
    const { execSync } = require('child_process');
    try {
      const result = execSync('pgrep -fl "agx.*daemon" 2>/dev/null || echo ""', { encoding: 'utf8' });
      if (result.trim()) {
        const pids = result.trim().split('\n').map(line => line.split(' ')[0]);
        for (const pid of pids) {
          execSync(`kill ${pid}`, { encoding: 'utf8' });
        }
        console.log(`${c.green}✓${c.reset} Container(s) stopped`);
      } else {
        console.log(`${c.dim}No running containers${c.reset}`);
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // agx audit - View local audit log
  if (cmd === 'audit') {
    const { readAuditLog, AUDIT_LOG_FILE } = require('./lib/security');

    // Parse flags
    let limit = 20;
    let taskId = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--limit' || args[i] === '-n') {
        limit = parseInt(args[++i]) || 20;
      } else if (args[i] === '--task' || args[i] === '-t') {
        taskId = args[++i];
      }
    }

    const entries = readAuditLog({ limit, taskId });

    if (entries.length === 0) {
      console.log(`${c.dim}No audit log entries${c.reset}`);
      console.log(`${c.dim}Log file: ${AUDIT_LOG_FILE}${c.reset}`);
      process.exit(0);
    }

    console.log(`${c.bold}Local Audit Log${c.reset} (${entries.length} entries)\n`);

    for (const entry of entries) {
      const time = new Date(entry.timestamp).toLocaleString();
      const actionColor = {
        execute: c.cyan,
        complete: c.green,
        reject: c.red,
        skip: c.yellow,
      }[entry.action] || c.dim;

      const resultIcon = {
        success: '✓',
        failed: '✗',
        rejected: '🚫',
        skipped: '⏭',
        pending: '...',
      }[entry.result] || '?';

      console.log(`${c.dim}${time}${c.reset} ${actionColor}${entry.action}${c.reset} ${resultIcon}`);
      console.log(`  Task: ${entry.title || entry.taskId?.slice(0, 8) || 'Unknown'}`);
      if (entry.stage) console.log(`  Stage: ${entry.stage}`);
      if (entry.signatureValid !== null) {
        console.log(`  Signature: ${entry.signatureValid ? '✓ valid' : '✗ invalid'}`);
      }
      if (entry.dangerousOps?.detected) {
        console.log(`  ${c.yellow}Dangerous: ${entry.dangerousOps.severity} - ${entry.dangerousOps.patterns.join(', ')}${c.reset}`);
      }
      if (entry.error) {
        console.log(`  ${c.red}Error: ${entry.error}${c.reset}`);
      }
      console.log('');
    }
    process.exit(0);
  }

  // agx security - Manage daemon security settings
  if (cmd === 'security') {
    const securityCmd = args[1];
    const { loadSecurityConfig, setupDaemonSecret, SECURITY_CONFIG_FILE } = require('./lib/security');

    if (securityCmd === 'status') {
      const config = loadSecurityConfig();
      console.log(`${c.bold}Daemon Security Status${c.reset}\n`);

      if (config?.daemonSecret) {
        console.log(`  ${c.green}✓${c.reset} Daemon secret: Configured`);
        console.log(`    Created: ${config.secretCreatedAt || 'Unknown'}`);
        if (config.secretRotatedAt) {
          console.log(`    Rotated: ${config.secretRotatedAt}`);
        }
      } else {
        console.log(`  ${c.yellow}⚠${c.reset} Daemon secret: Not configured`);
        console.log(`    ${c.dim}Run: agx login to generate${c.reset}`);
      }

      console.log(`\n  Config: ${SECURITY_CONFIG_FILE}`);
      process.exit(0);
    }

    if (securityCmd === 'rotate') {
      const config = loadCloudConfig();
      if (!config) {
        console.log(`${c.red}Not logged in.${c.reset} Run: agx login`);
        process.exit(1);
      }

      const confirm = await prompt(`${c.yellow}Rotate daemon secret?${c.reset} This will invalidate all pending signed tasks. (y/N): `);
      if (confirm?.toLowerCase() !== 'y' && confirm?.toLowerCase() !== 'yes') {
        console.log(`${c.dim}Cancelled${c.reset}`);
        process.exit(0);
      }

      const { secret, isNew } = await setupDaemonSecret({
        force: true,
        cloudApiUrl: config.apiUrl,
        cloudToken: config.token,
      });

      console.log(`${c.green}✓${c.reset} Daemon secret rotated`);
      process.exit(0);
    }

    // Default: show security help
    console.log(`${c.bold}agx security${c.reset} - Manage daemon security\n`);
    console.log(`  agx security status    Show security configuration`);
    console.log(`  agx security rotate    Rotate daemon secret`);
    process.exit(0);
  }


  // Login command
  if (cmd === 'login') {
    const provider = args[1];
    if (!provider) {
      console.log(`${c.yellow}Usage:${c.reset} agx login <provider>`);
      console.log(`${c.dim}Providers: claude, gemini, ollama, codex${c.reset}`);
      process.exit(1);
    }
    if (!['claude', 'gemini', 'ollama', 'codex'].includes(provider)) {
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
      console.log(`${c.dim}Providers: claude, gemini, ollama, codex${c.reset}`);
      process.exit(1);
    }
    if (!['claude', 'gemini', 'ollama', 'codex'].includes(provider)) {
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
    'x': 'codex',
    'codex': 'codex',
    'o': 'ollama',
    'ol': 'ollama',
    'ollama': 'ollama'
  };

  const VALID_PROVIDERS = ['gemini', 'claude', 'ollama', 'codex'];

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
  --swarm             Run task via swarm (agx run)

PROVIDERS:
  claude, c    Anthropic Claude Code
  codex, x     OpenAI Codex
  gemini, g    Google Gemini
  ollama, o    Local Ollama

CLOUD:
  agx login [url]        Login to cloud
  agx new "<task>"       Create task in cloud
  agx run <id|slug|#>    Claim and run a task
  agx retry <id|slug|#>  Reset + retry a task
  agx status             Show cloud status
  agx complete <taskId>  Mark task stage complete

CHECKING ON TASKS:
  agx task ls           Browse cloud tasks
  agx task run <id|slug|#>  Claim and run a task
  agx task reset <id>   Reset a task to queued
  agx task logs <id> -f View/tail task logs
  agx task tail <id>    Tail task logs
  agx task clear <id|slug|#>  Clear comments and logs
  agx comments clear <id|slug|#>  Clear comments only
  agx comments ls <id|slug|#>     List comments only
  agx comments tail <id|slug|#>   Tail comments only
  agx logs clear <id|slug|#>      Clear logs only
  agx logs ls <id|slug|#>         List logs only
  agx logs tail <id|slug|#>       Tail logs only
  agx task stop <id>    Stop a task
  agx task rm <id>      Remove a task
  agx container ls      List running containers
  agx container logs    Daemon activity

EXAMPLES:
  agx -a -p "Build a todo app"    # Start autonomous task
  agx claude -p "explain this"    # One-shot question
  agx codex -p "refactor this"    # One-shot question
  agx task ls               # Check cloud tasks
  agx container logs         # See what's happening`);
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
      console.log(`  ${c.dim}agx codex --prompt "hello"${c.reset}`);
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
    cloud: null, // null = auto-detect, true = force on, false = force off
    cloudTaskId: null,
    autonomous: false,
    daemon: false
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
      case '--autonomous':
      case '--auto':
      case '-a':
        options.autonomous = true;
        options.yolo = true; // Autonomous = unattended, skip prompts
        break;
      case '--cloud-task':
        if (nextArg && !nextArg.startsWith('-')) {
          options.cloudTaskId = nextArg;
          i++;
        }
        break;
      case '--daemon':
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
  const finalPrompt = options.prompt || positionalArgs.join(' ');

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
  } else if (provider === 'codex') {
    command = 'codex';

    // Use non-interactive mode whenever this is a scripted invocation.
    const shouldUseExec = options.cloudTaskId
      || options.autonomous
      || options.daemon
      || options.print
      || (finalPrompt && !options.interactive);
    if (shouldUseExec) {
      translatedArgs.unshift('exec');
    }

    if (finalPrompt) {
      translatedArgs.push(finalPrompt);
    }
  } else if (provider === 'ollama') {
    // Ollama now routes through Claude CLI with Ollama base URL
    command = 'claude';
    translatedArgs.length = 0; // Clear any accumulated args

    // Environment variables for Ollama-via-Claude
    env.ANTHROPIC_AUTH_TOKEN = 'ollama';
    env.ANTHROPIC_BASE_URL = 'http://localhost:11434';
    env.ANTHROPIC_API_KEY = '';

    // Claude flags for Ollama compatibility
    translatedArgs.push('--dangerously-skip-permissions');

    // Get model from options or config
    const ollamaModel = options.model || config?.ollama?.model || 'llama3.2:3b';
    translatedArgs.push('--model', ollamaModel);

    if (finalPrompt) {
      translatedArgs.push('-p', finalPrompt);
    }
  } else {
    // Claude
    command = 'claude';

    // Claude-specific translations
    if (options.yolo) translatedArgs.push('--dangerously-skip-permissions');
    // Default to --print when prompt is provided and --interactive not specified
    if (options.print || (finalPrompt && !options.interactive)) {
      translatedArgs.push('--print');
    }
    if (options.mcp) translatedArgs.push('--mcp-config', options.mcp);

    // Claude prompt (positional at end)
    if (finalPrompt) {
      translatedArgs.push(finalPrompt);
    }
  }

  // Append raw args at the end
  translatedArgs.push(...rawArgs);

  // ==================== CLOUD INTEGRATION ====================

  // Cloud context logic:
  // - agx -p "..." → one-shot, no task
  // - agx -a -p "..." → create new task in cloud
  // - agx --cloud-task <id> → continue cloud task (used by daemon)

  const CLOUD_CONFIG_FILE = path.join(CONFIG_DIR, 'cloud.json');

  function loadCloudConfig() {
    try {
      if (fs.existsSync(CLOUD_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
      }
    } catch { }
    return null;
  }

  function saveCloudConfig(config) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CLOUD_CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  async function tryRefreshCloudToken(config) {
    if (!config?.apiUrl || !config?.refreshToken) return null;

    try {
      const response = await fetch(`${config.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: config.refreshToken }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch { }

      if (!response.ok || !data?.access_token) {
        return null;
      }

      const updated = {
        ...config,
        token: data.access_token,
        refreshToken: data.refresh_token || config.refreshToken,
      };
      saveCloudConfig(updated);
      return updated;
    } catch {
      return null;
    }
  }

  async function cloudRequest(method, endpoint, body = null) {
    const config = loadCloudConfig();
    if (!config?.apiUrl || !config?.token) {
      throw new Error('Not logged in to cloud. Run: agx login');
    }

    const url = `${config.apiUrl}${endpoint}`;
    const makeRequest = async (cfg) => {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.token}`,
          'x-user-id': cfg.userId || '',
        },
      };
      if (body) fetchOptions.body = JSON.stringify(body);
      const response = await fetch(url, fetchOptions);
      let data = null;
      try {
        data = await response.json();
      } catch { }
      return { response, data };
    };

    let activeConfig = config;
    let { response, data } = await makeRequest(activeConfig);

    if (response.status === 401) {
      const refreshedConfig = await tryRefreshCloudToken(activeConfig);
      if (refreshedConfig?.token) {
        activeConfig = refreshedConfig;
        ({ response, data } = await makeRequest(activeConfig));
      }
    }

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data;
  }

  // --cloud-task: load existing task from cloud (used by daemon)
  if (options.cloudTaskId) {
    try {
      const { task } = await cloudRequest('GET', `/api/tasks/${options.cloudTaskId}`);

      // Build augmented prompt with task context
      const plan = extractSection(task.content, 'Plan');
      const todo = extractSection(task.content, 'Todo') || extractSection(task.content, 'TODO');
      const checkpoints = extractSection(task.content, 'Checkpoints');
      const learnings = extractSection(task.content, 'Learnings');

      const stageKey = task?.stage || 'unknown';
      const stagePrompt = resolveStageObjective(task, stageKey, '');
      const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

      let augmentedPrompt = task.prompt || `## Cloud Task Context

You are continuing a cloud task. Here is the current state:

Task ID: ${task.id}
Title: ${task.title || 'Untitled'}
Stage: ${task.stage || 'ideation'}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}
Status: ${task.status || 'unknown'}

${task.content ? `---\n${task.content}\n---` : ''}

## Extracted State

Goal: ${task.title || 'Untitled'}
Plan: ${plan || '(none)'}
Todo: ${todo || '(none)'}
Checkpoints: ${checkpoints || '(none)'}
Learnings: ${learnings || '(none)'}

`;
      if (!task.prompt && task.engine) {
        augmentedPrompt += `Engine: ${task.engine}\n`;
      }

      augmentedPrompt += `
## Instructions

Continue working on this task. Use the cloud API to sync progress.
Respect the Stage Completion Requirement before using [complete] or [done].

To update the task:
- [done] - Mark task complete
- [complete: message] - Complete current stage
- [log: message] - Add a log entry
- [checkpoint: message] - Save progress checkpoint
- [learn: insight] - Record a learning
- [plan: text] - Update plan
- [todo: text] - Update todo list

${finalPrompt ? `Your specific task: ${finalPrompt}` : ''}
`;

      const promptIndex = translatedArgs.indexOf(finalPrompt);
      if (promptIndex !== -1) {
        translatedArgs[promptIndex] = augmentedPrompt;
      } else {
        translatedArgs.push(augmentedPrompt);
      }
      saveAugmentedPrompt(augmentedPrompt, options.debug);

      console.log(`${c.dim}[cloud] Loaded task: ${task.title || task.id}${c.reset}\n`);
    } catch (err) {
      console.error(`${c.red}Failed to load cloud task:${c.reset} ${err.message}`);
      process.exit(1);
    }
  }

  // Auto-create task in cloud if --autonomous specified
  if (options.autonomous && finalPrompt && !options.cloudTaskId) {
    console.log(`${c.dim}[cloud] Creating task...${c.reset}`);

    try {
      const cloudConfig = loadCloudConfig();
      if (cloudConfig?.apiUrl && cloudConfig?.token) {
        const frontmatter = ['status: queued', 'stage: ideation'];
        frontmatter.push(`engine: ${provider}`);

        const content = `---\n${frontmatter.join('\n')}\n---\n\n# ${finalPrompt}\n`;

        const { task } = await cloudRequest('POST', '/api/tasks', { content });

        console.log(`${c.green}✓${c.reset} Task created in cloud: ${task.id}`);
        options.cloudTaskId = task.id;

        // Update prompt with task context
        const stageKey = task?.stage || 'unknown';
        const stagePrompt = resolveStageObjective(task, stageKey, '');
        const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

        let augmentedPrompt = `## Cloud Task Context

Task ID: ${task.id}
Title: ${task.title || finalPrompt}
Stage: ${task.stage}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}
Status: ${task.status}

---

## Instructions

You are starting a new autonomous task. Work until completion or blocked.
Respect the Stage Completion Requirement before using [complete] or [done].

To update the task:
- [done] - Mark task complete
- [complete: message] - Complete current stage
- [log: message] - Add a log entry

Goal: ${finalPrompt}
`;

        const promptIndex = translatedArgs.indexOf(finalPrompt);
        if (promptIndex !== -1) {
          translatedArgs[promptIndex] = augmentedPrompt;
        } else {
          translatedArgs.push(augmentedPrompt);
        }
        saveAugmentedPrompt(augmentedPrompt, options.debug);

        // Start daemon for autonomous mode
        if (options.autonomous) {
          startDaemon();
          console.log(`${c.green}✓${c.reset} Autonomous mode: daemon running\n`);
        }
      } else {
        console.log(`${c.yellow}Not connected to cloud. Run: agx login${c.reset}`);
        console.log(`${c.dim}Task not created. Running in one-shot mode.${c.reset}`);
      }
    } catch (err) {
      console.error(`${c.yellow}Warning: Could not create cloud task:${c.reset} ${err.message}`);
      console.log(`${c.dim}Running in one-shot mode.${c.reset}`);
    }
  }

  // Normal mode - just pass through to provider
  const useOllamaPipe = provider === 'ollama' && options.ollamaPrompt && command === 'ollama';
  const child = spawn(command, translatedArgs, {
    env,
    stdio: useOllamaPipe ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    shell: false
  });

  // Send prompt to Ollama via stdin
  if (useOllamaPipe && child.stdin) {
    child.stdin.write(options.ollamaPrompt);
    child.stdin.end();
  }

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
        console.error(`  npm install -g @google/gemini-cli`);
      } else if (command === 'ollama') {
        console.error(`  brew install ollama  # macOS`);
        console.error(`  curl -fsSL https://ollama.ai/install.sh | sh  # Linux`);
      }
    } else {
      console.error(`${c.red}Failed to start ${command}:${c.reset}`, err.message);
    }
    process.exit(1);
  });

})();

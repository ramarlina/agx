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
const os = require('os');
const path = require('path');
const readline = require('readline');
const {
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement
} = require('./lib/stage-requirements');
const { detectVerifyCommands, runVerifyCommands, getGitSummary } = require('./lib/verifier');
const { createOrchestrator } = require('./lib/orchestrator');
const {
  CANCELLED_ERROR_CODE,
  CancellationRequestedError,
  createCancellationWatcher,
  extractCancellationReason,
  isCancellationPayload,
} = require('./lib/workerCancellation');
const {
  collectProjectFlags,
  buildProjectBody,
  createProject,
} = require('./lib/project-cli');

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

## Cloud

\`\`\`bash
AGX_CLOUD_URL=http://localhost:41741 agx status
AGX_CLOUD_URL=http://localhost:41741 agx task ls
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
const SWARM_MAX_ITERS = Number(process.env.AGX_SWARM_MAX_ITERS || 2);
const SINGLE_MAX_ITERS = Number(process.env.AGX_SINGLE_MAX_ITERS || 6);
const VERIFY_TIMEOUT_MS = Number(process.env.AGX_VERIFY_TIMEOUT_MS || 5 * 60 * 1000);
const VERIFY_PROMPT_MAX_CHARS = Number(process.env.AGX_VERIFY_PROMPT_MAX_CHARS || 6000);
const SWARM_LOG_FLUSH_MS = Number(process.env.AGX_SWARM_LOG_FLUSH_MS || 500);
const SWARM_LOG_MAX_BYTES = Number(process.env.AGX_SWARM_LOG_MAX_BYTES || 8000);
let retryFlowActive = false;

function logExecutionFlow(step, phase, detail = '') {
  //if (!retryFlowActive) return;
  if (['cloudRequest', 'loadCloudConfig'].includes(step)) return;
  const info = detail ? ` | ${detail}` : '';
  console.log(`[worker] ${step} | ${phase}${info}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function abortIfCancelled(watcher) {
  if (!watcher) return;
  if (typeof watcher.check === 'function') {
    await watcher.check();
  }
  if (watcher.isCancelled && watcher.isCancelled()) {
    const reason = (watcher.getReason && watcher.getReason()) || 'Cancelled by operator';
    throw new CancellationRequestedError(reason);
  }
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

function truncateForComment(text, maxChars = 12000) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return `[truncated]\n\n${value.slice(-maxChars)}`;
}

function cleanAgentOutputForComment(text) {
  if (!text) return '';
  const finalChunk = (String(text).split('[3m[35mtokens used[0m[0m').slice(-1)[0] || '').trim();
  const lines = finalChunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const noiseMatchers = [
    /^tool call result/i,
    /^tool call results/i,
    /^thinking tokens/i
  ];

  const filteredLines = lines.filter((line) => {
    return !noiseMatchers.some((matcher) => matcher.test(line));
  });

  const cleaned = filteredLines.join('\n').trim();
  return cleaned || finalChunk;
}

function extractFileRefsFromText(text, { max = 20 } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const exts = '(?:md|js|mjs|cjs|ts|tsx|jsx|json|patch|diff|txt|ndjson|yaml|yml)';
  const refs = new Set();
  const addRef = (ref) => {
    const value = String(ref || '').trim();
    if (!value) return;
    if (refs.has(value)) return;
    refs.add(value);
  };

  const patterns = [
    // Absolute POSIX paths, optionally with :line or :line:col suffix.
    new RegExp(String.raw`(?:^|\s)(\/[^\s'"<>]+?\.(?:${exts})(?::\d+(?::\d+)?)?)(?=$|\s)`, 'g'),
    // Repo-relative paths, optionally with :line or :line:col suffix.
    new RegExp(String.raw`(?:^|\s)([A-Za-z0-9_.\/-]+?\.(?:${exts})(?::\d+(?::\d+)?)?)(?=$|\s)`, 'g'),
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(raw)) !== null) {
      const candidate = String(match[1] || '').replace(/[),.;\]]+$/g, '');
      if (!candidate) continue;

      const [filePart] = candidate.split(':');
      if (!filePart) continue;

      // Only keep refs that exist on disk (helps avoid random false positives).
      const abs = filePart.startsWith('/') ? filePart : path.resolve(process.cwd(), filePart);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const suffix = candidate.slice(filePart.length); // preserve :line[:col] if present
          addRef(`${abs}${suffix}`);
          if (refs.size >= max) break;
        }
      } catch { }
      if (refs.size >= max) break;
    }
    if (refs.size >= max) break;
  }

  return Array.from(refs);
}

async function postTaskLog(taskId, content, logType) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) return;

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify({ content, log_type: logType })
    });
  } catch { }
}

async function postTaskComment(taskIdOrParams, contentMaybe) {
  // Back-compat: callers historically used both `postTaskComment(taskId, content)`
  // and the (incorrect) `postTaskComment({ taskId, comment })` shape.
  let taskId = null;
  let content = null;

  if (taskIdOrParams && typeof taskIdOrParams === 'object') {
    taskId = String(taskIdOrParams.taskId || taskIdOrParams.task_id || taskIdOrParams.id || '').trim();
    content = taskIdOrParams.content || taskIdOrParams.comment || '';
  } else {
    taskId = String(taskIdOrParams || '').trim();
    content = contentMaybe || '';
  }

  if (!taskId) return;
  if (!content) return;

  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) return;

  logExecutionFlow('postTaskComment', 'input', `taskId=${taskId}`);
  logExecutionFlow('postTaskComment', 'processing', `POST /api/tasks/${taskId}/comments`);

  const truncatedContent = truncateForComment(String(content));

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
        'x-user-id': cloudConfig.userId || '',
      },
      // Some server builds expect `content`, older clients used `truncatedContent`.
      body: JSON.stringify({ content: truncatedContent, truncatedContent })
    });
    logExecutionFlow('postTaskComment', 'output', 'success');
  } catch (err) {
    logExecutionFlow('postTaskComment', 'output', `failed ${err?.message || err}`);
  }
}

function isLocalArtifactsEnabled() {
  // Single cutover: always on, no opt-out.
  return true;
}

function mapCloudStageToLocalStage(stage) {
  const raw = String(stage || '').toLowerCase().trim();
  if (raw === 'plan' || raw === 'execute' || raw === 'verify' || raw === 'resume') return raw;
  if (raw === 'ideation' || raw === 'planning') return 'plan';
  if (raw === 'verification') return 'verify';
  return 'execute';
}

function shortStableHex(value, len = 6) {
  const v = String(value || '');
  if (!v) return crypto.randomBytes(Math.max(2, Math.ceil(len / 2))).toString('hex').slice(0, len);
  return crypto.createHash('sha1').update(v).digest('hex').slice(0, len);
}

function extractCloudProjectIdentity(task) {
  const projectObj = task?.project && typeof task.project === 'object' ? task.project : null;
  const projectId =
    task?.project_id ||
    task?.projectId ||
    projectObj?.id ||
    projectObj?.project_id ||
    null;

  const projectSlug =
    task?.project_slug ||
    projectObj?.slug ||
    projectObj?.project_slug ||
    (typeof task?.project === 'string' ? task.project : null) ||
    null;

  const projectName =
    task?.project_name ||
    projectObj?.name ||
    projectObj?.project_name ||
    null;

  return { projectId: projectId ? String(projectId) : null, projectSlug: projectSlug ? String(projectSlug) : null, projectName: projectName ? String(projectName) : null };
}

function extractCloudTaskIdentity(task) {
  const taskId = task?.id ? String(task.id).trim() : '';
  const taskSlug = task?.slug ? String(task.slug).trim() : '';
  return { taskId, taskSlug };
}

async function resolveLocalProjectSlugForCloudTask(storage, task) {
  const { projectId, projectSlug, projectName } = extractCloudProjectIdentity(task);
  const label = projectSlug || projectName || 'cloud';
  const base = storage.slugify(label, { maxLength: 64 });
  const baseState = await storage.readProjectState(base);

  if (!baseState) {
    return base;
  }

  const baseCloudId = baseState?.cloud?.project_id ? String(baseState.cloud.project_id) : null;
  // Back-compat: if base exists but has no cloud id, "adopt" it (this preserves the pre-collision behavior).
  if (!baseCloudId && projectId) {
    return base;
  }
  if (baseCloudId && projectId && baseCloudId === projectId) {
    return base;
  }

  // Collision: choose a stable suffix derived from cloud project id when available.
  const suffix = projectId ? shortStableHex(projectId, 6) : shortStableHex(`${label}:${process.cwd()}:${Date.now()}`, 6);
  const trimmedBase = storage.slugify(label, { maxLength: 64 - (1 + suffix.length) });
  let candidate = `${trimmedBase}-${suffix}`;

  // If even the suffixed candidate exists but belongs to someone else, fall back to numeric increments.
  for (let i = 0; i < 200; i += 1) {
    const s = await storage.readProjectState(candidate);
    if (!s) return candidate;
    const cid = s?.cloud?.project_id ? String(s.cloud.project_id) : null;
    if (projectId && cid === projectId) return candidate;
    candidate = `${trimmedBase}-${suffix}-${i + 1}`;
  }

  // Extremely unlikely fallback.
  return `${trimmedBase}-${suffix}-${crypto.randomBytes(2).toString('hex')}`;
}

async function resolveLocalTaskSlugForCloudTask(storage, projectSlug, task) {
  const { taskId, taskSlug: cloudTaskSlug } = extractCloudTaskIdentity(task);
  const label = cloudTaskSlug || taskId;
  const desired = storage.slugify(label, { maxLength: 64 });

  const existing = await storage.readTaskState(projectSlug, desired);
  if (!existing) return desired;

  const existingCloudTaskId = existing?.cloud?.task_id ? String(existing.cloud.task_id) : null;
  // Back-compat: if a folder exists without cloud id, adopt it (preserves previous behavior).
  if (!existingCloudTaskId && taskId) return desired;
  if (existingCloudTaskId && taskId && existingCloudTaskId === taskId) return desired;

  // Collision: prefer a stable suffix based on task id.
  const suffix = taskId ? shortStableHex(taskId, 6) : shortStableHex(`${label}:${Date.now()}`, 6);
  const trimmedBase = storage.slugify(label, { maxLength: 64 - (1 + suffix.length) });
  let candidate = `${trimmedBase}-${suffix}`;

  for (let i = 0; i < 200; i += 1) {
    const st = await storage.readTaskState(projectSlug, candidate);
    if (!st) return candidate;
    const cid = st?.cloud?.task_id ? String(st.cloud.task_id) : null;
    if (taskId && cid === taskId) return candidate;
    candidate = `${trimmedBase}-${suffix}-${i + 1}`;
  }

  return `${trimmedBase}-${suffix}-${crypto.randomBytes(2).toString('hex')}`;
}

function renderWorkingSetMarkdownFromCloudTask(task) {
  const currentPlan = typeof task?.current_plan === 'string' ? task.current_plan.trim() : '';
  const openBlockers = Array.isArray(task?.open_blockers) ? task.open_blockers.filter(Boolean).map(String) : [];
  const nextAction = typeof task?.next_action === 'string' ? task.next_action.trim() : '';

  if (!currentPlan && openBlockers.length === 0 && !nextAction) return '';

  const lines = ['# Working Set', ''];
  if (currentPlan) {
    lines.push('## Current Plan', '', currentPlan.trim(), '');
  }
  if (openBlockers.length > 0) {
    lines.push('## Open Blockers', '');
    for (const blocker of openBlockers) lines.push(`- ${blocker}`);
    lines.push('');
  }
  if (nextAction) {
    lines.push('## Next Action', '', nextAction.trim(), '');
  }
  return lines.join('\n').trim() + '\n';
}

function createDaemonArtifactsRecorder({ storage, run, taskId }) {
  const promptParts = [];
  const outputParts = [];

  const pushSection = (arr, title, text) => {
    if (!text) return;
    arr.push(`# ${title}`.trim(), '');
    arr.push(String(text).trim(), '');
    // Keep a clear separator between sections.
    arr.push('---', '');
  };

  return {
    get runPath() {
      return run?.paths?.root || null;
    },
    recordPrompt(title, text) {
      pushSection(promptParts, title, text);
    },
    recordOutput(title, text) {
      pushSection(outputParts, title, text);
    },
    async recordEngineTrace(meta, traceEvent) {
      if (!storage || !run?.paths?.events || !traceEvent) return;
      const safeMeta = meta && typeof meta === 'object' ? meta : {};

      try {
        if (traceEvent.phase === 'start') {
          await storage.appendEvent(
            run.paths.events,
            storage.engineCallStartedEvent({
              trace_id: traceEvent.id,
              label: traceEvent.label,
              provider: safeMeta.provider || null,
              model: safeMeta.model || null,
              role: safeMeta.role || null,
              pid: traceEvent.pid ?? null,
              args: traceEvent.args,
              timeout_ms: traceEvent.timeout_ms,
              started_at: traceEvent.started_at,
            })
          );
          return;
        }

        if (traceEvent.phase === 'exit' || traceEvent.phase === 'error' || traceEvent.phase === 'timeout') {
          await storage.appendEvent(
            run.paths.events,
            storage.engineCallCompletedEvent({
              trace_id: traceEvent.id,
              label: traceEvent.label,
              provider: safeMeta.provider || null,
              model: safeMeta.model || null,
              role: safeMeta.role || null,
              phase: traceEvent.phase,
              exit_code: traceEvent.exit_code ?? null,
              duration_ms: traceEvent.duration_ms,
              finished_at: traceEvent.finished_at,
              stdout_tail: traceEvent.stdout_tail,
              stderr_tail: traceEvent.stderr_tail,
              error: traceEvent.error,
            })
          );
        }
      } catch {
        // Never let trace/event writing break daemon execution.
      }
    },
    async flush() {
      const promptText = promptParts.join('\n').trim() + '\n';
      const outputText = outputParts.join('\n').trim() + '\n';

      if (promptText.trim()) {
        const totalBytes = Buffer.byteLength(promptText, 'utf8');
        const event = storage.promptBuiltEvent({ sections: { daemon: totalBytes }, total_bytes: totalBytes });
        await storage.writePrompt(run, promptText, event);
      }

      if (outputText.trim()) {
        await storage.writeOutput(run, outputText);
      }

      await storage.appendEvent(run.paths.events, { t: 'DAEMON_ARTIFACTS_FLUSHED', task_id: taskId });
    }
  };
}

function localArtifactKey(filePath) {
  const host = os.hostname();
  const p = String(filePath || '');
  if (!p) return `local://${host}/`;
  // Use a URI-like prefix to make it obvious this is a local-only pointer.
  return `local://${host}${p.startsWith('/') ? '' : '/'}${p}`;
}

async function buildLocalRunIndexEntry(storage, run, status) {
  if (!storage || !run?.paths?.root) return null;

  const maxShaBytes = Number(process.env.AGX_LOCAL_ARTIFACT_SHA_MAX_BYTES || 5 * 1024 * 1024);
  const shaMax = Number.isFinite(maxShaBytes) && maxShaBytes > 0 ? maxShaBytes : 5 * 1024 * 1024;

  const sha256File = async (filePath) => {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > shaMax) {
      return { bytes: stat.size, sha256: undefined };
    }

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve({ bytes: stat.size, sha256: hash.digest('hex') }));
    });
  };

  const tryRef = async (kind, filePath) => {
    try {
      const { bytes, sha256 } = await sha256File(filePath);
      return { kind, key: localArtifactKey(filePath), bytes, sha256 };
    } catch {
      return null;
    }
  };

  const meta = await storage.readJsonSafe(run.paths.meta);
  const createdAt = meta?.created_at || new Date().toISOString();

  const manifest = [];
  manifest.push({ kind: 'artifact', key: localArtifactKey(run.paths.root) });

  const promptRef = await tryRef('prompt', run.paths.prompt);
  if (promptRef) manifest.push(promptRef);

  const outputRef = await tryRef('output', run.paths.output);
  if (outputRef) manifest.push(outputRef);

  const eventsRef = await tryRef('events', run.paths.events);
  if (eventsRef) manifest.push(eventsRef);

  const decisionRef = await tryRef('artifact', run.paths.decision);
  if (decisionRef) manifest.push({ ...decisionRef, kind: 'artifact' });

  return {
    run_id: run.run_id,
    stage: run.stage,
    engine: meta?.engine || meta?.provider || meta?.engine_name || run.engine || 'unknown',
    model: meta?.model || null,
    status: String(status || 'unknown'),
    created_at: createdAt,
    artifact_manifest: manifest,
  };
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

async function patchTaskState(taskId, state) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) return;

  logExecutionFlow('patchTaskState', 'input', `taskId=${taskId}, state=${JSON.stringify(state)}`);
  logExecutionFlow('patchTaskState', 'processing', `PATCH /api/tasks/${taskId}`);

  try {
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify(state)
    });
    logExecutionFlow('patchTaskState', 'output', 'success');
  } catch (err) {
    logExecutionFlow('patchTaskState', 'output', `failed ${err?.message || err}`);
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
    if (!cloudConfig?.apiUrl) return;

    logExecutionFlow('updateTaskSection', 'input', `taskId=${taskId}, heading=${heading}, mode=${mode}`);
    logExecutionFlow('updateTaskSection', 'processing', `GET /api/tasks/${taskId}`);
    try {
      const res = await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
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
        logExecutionFlow('updateTaskSection', 'processing', 'PUT content update');
        await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
            'x-user-id': cloudConfig.userId || '',
          },
          body: JSON.stringify({ content: updated })
        });
        logExecutionFlow('updateTaskSection', 'output', 'updated');
      } else {
        logExecutionFlow('updateTaskSection', 'output', 'no change');
      }
    } catch (err) {
      logExecutionFlow('updateTaskSection', 'output', `failed ${err?.message || err}`);
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

function extractJsonLast(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/\u001b\[[0-9;]*m/g, '');

  // Walk from the end: find the last parseable JSON object.
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (cleaned[i] !== '}') continue;
    let depth = 0;
    for (let j = i; j >= 0; j -= 1) {
      const ch = cleaned[j];
      if (ch === '}') depth += 1;
      if (ch === '{') {
        depth -= 1;
        if (depth === 0) {
          const maybe = cleaned.slice(j, i + 1);
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

function ensureExplanation(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  if (typeof decision.explanation === 'string' && decision.explanation.trim()) return decision;

  const source = [decision.summary, decision.final_result, decision.next_prompt]
    .find((v) => typeof v === 'string' && v.trim());

  return {
    ...decision,
    explanation: source ? source.trim() : 'No explanation provided.'
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

/**
 * Build the full daemon prompt context for artifact recording.
 * This mirrors the prompt constructed by the --cloud-task handler.
 * @param {object} task - The cloud task object
 * @param {object} options
 * @param {string[]} [options.comments] - Task thread comments
 * @param {string} [options.provider] - Engine provider
 * @param {string} [options.model] - Model name
 * @param {string} [options.iterationPrompt] - Optional iteration-specific prompt
 * @returns {string}
 */
function buildFullDaemonPromptContext(task, options = {}) {
  const comments = Array.isArray(options.comments) ? options.comments : [];
  const provider = options.provider || task?.engine || task?.provider || 'unknown';
  const model = options.model || task?.model || null;
  const iterationPrompt = options.iterationPrompt || '';

  const plan = extractSection(task?.content, 'Plan');
  const todo = extractSection(task?.content, 'Todo') || extractSection(task?.content, 'TODO');
  const checkpoints = extractSection(task?.content, 'Checkpoints');
  const learnings = extractSection(task?.content, 'Learnings');

  const stageKey = task?.stage || 'unknown';
  const stagePrompt = typeof resolveStageObjective === 'function'
    ? resolveStageObjective(task, stageKey, '')
    : '';
  const stageRequirement = typeof buildStageRequirementPrompt === 'function'
    ? buildStageRequirementPrompt({ stage: stageKey, stagePrompt })
    : '';

  const commentsSection = comments.length > 0
    ? comments.map(c => `${c.author || 'user'}: ${c.content || ''}`).join('\n')
    : '(no comments yet)';

  let prompt = `## Cloud Task Context

You are continuing a cloud task. Here is the current state:

Task ID: ${task?.id || 'unknown'}
Title: ${task?.title || 'Untitled'}
Stage: ${task?.stage || 'ideation'}
Stage Objective: ${stagePrompt}
Stage Completion Requirement (guidance): ${stageRequirement}
Provider: ${provider}${model ? `/${model}` : ''}

User Request: 
"""
${task?.title || ''}
${task?.content || ''}
---
Task Thread:
${commentsSection}
"""

## Extracted State

Goal: ${task?.title || 'Untitled'}
Plan: ${plan || '(none)'}
Todo: ${todo || '(none)'}
Checkpoints: ${checkpoints || '(none)'}
Learnings: ${learnings || '(none)'}

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
`;

  if (iterationPrompt) {
    prompt += `\nYour specific task for this iteration: ${iterationPrompt}\n`;
  }

  return prompt;
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


function appendTail(prev, chunk, maxChars = 4000) {
  const next = `${prev || ''}${String(chunk || '')}`;
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}

function truncateForTemporalTrace(str, maxChars = 2000) {
  if (!str) return '';
  if (str.length <= maxChars) return str;
  return str.slice(-maxChars);
}

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { }
  return crypto.createHash('sha1').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12);
}


async function updateCloudTask(taskId, updates) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) return;
  if (!taskId) return;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-user-id': cloudConfig.userId || '',
    };
    if (cloudConfig?.token) {
      headers.Authorization = `Bearer ${cloudConfig.token}`;
    }
    // Assume standard API route is /api/tasks/:id
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates),
    });
  } catch (err) {
    // Silent fail or log debug
    // console.debug('Failed to update cloud task', err);
  }
}

function runAgxCommand(args, timeoutMs, label, handlers = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;

    const childArgs = sanitizeCliArgs([process.argv[1], ...args]);
    logExecutionFlow('runAgxCommand', 'input', `label=${label}, args=${childArgs.join(' ')}, timeout=${timeoutMs}`);
    const cancellationWatcher = handlers.cancellationWatcher || null;
    const child = spawnCloudTaskProcess(childArgs);
    logExecutionFlow('runAgxCommand', 'processing', `spawning child process (pid: ${child.pid})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const traceId = randomId();
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const emitTrace = (event) => {
      if (!handlers || typeof handlers.onTrace !== 'function') return;
      try {
        handlers.onTrace(event);
      } catch { }
    };

    emitTrace({
      id: traceId,
      phase: 'start',
      label,
      args: childArgs,
      pid: child?.pid || null,
      timeout_ms: timeoutMs,
      started_at: startedAtIso,
    });

    if (cancellationWatcher?.start) {
      try {
        cancellationWatcher.start();
      } catch { }
    }

    let cancelUnsubscribe = null;
    const cleanupCancellation = () => {
      if (cancelUnsubscribe) {
        cancelUnsubscribe();
        cancelUnsubscribe = null;
      }
    };

    const handleCancellation = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (child && typeof child.kill === 'function') {
        child.kill('SIGTERM');
        setTimeout(() => {
          child.kill('SIGKILL');
        }, 500);
      }
      const reason = extractCancellationReason(payload) || 'Cancelled by operator';
      const err = new CancellationRequestedError(reason);
      err.code = CANCELLED_ERROR_CODE;
      err.payload = payload;
      err.stdout = stdout;
      err.stderr = stderr;
      emitTrace({
        id: traceId,
        phase: 'cancel',
        label,
        args: childArgs,
        pid: child?.pid || null,
        timeout_ms: timeoutMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        stdout_tail: truncateForTemporalTrace(stdoutTail),
        stderr_tail: truncateForTemporalTrace(stderrTail),
        error: err.message,
      });
      cleanupCancellation();
      reject(err);
    };

    if (cancellationWatcher?.onCancel) {
      cancelUnsubscribe = cancellationWatcher.onCancel(handleCancellation);
    }

    controller.signal.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      const err = new Error(`${label || 'command'} timed out`);
      err.code = 'ETIMEDOUT';
      clearTimeout(timeout);
      emitTrace({
        id: traceId,
        phase: 'timeout',
        label,
        args: childArgs,
        pid: child?.pid || null,
        timeout_ms: timeoutMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        stdout_tail: truncateForTemporalTrace(stdoutTail),
        stderr_tail: truncateForTemporalTrace(stderrTail),
        error: err.message,
      });
      cleanupCancellation();
      reject(err);
    });

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutTail = appendTail(stdoutTail, chunk);
      if (handlers.onStdout) handlers.onStdout(data);
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      stderrTail = appendTail(stderrTail, chunk);
      if (handlers.onStderr) handlers.onStderr(data);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      logExecutionFlow('runAgxCommand', 'output', `error ${err?.message || err}`);
      emitTrace({
        id: traceId,
        phase: 'error',
        label,
        args: childArgs,
        pid: child?.pid || null,
        timeout_ms: timeoutMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        stdout_tail: truncateForTemporalTrace(stdoutTail),
        stderr_tail: truncateForTemporalTrace(stderrTail),
        error: err?.message || String(err),
      });
      cleanupCancellation();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      logExecutionFlow('runAgxCommand', 'output', `pid=${child.pid}, exit code=${code}`);
      emitTrace({
        id: traceId,
        phase: 'exit',
        label,
        args: childArgs,
        pid: child?.pid || null,
        timeout_ms: timeoutMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        exit_code: code,
        stdout_tail: truncateForTemporalTrace(stdoutTail),
        stderr_tail: truncateForTemporalTrace(stderrTail),
      });
      cleanupCancellation();
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

async function runSwarmIteration({ taskId, task, prompt, logger, artifacts, cancellationWatcher, onProviderStdout, onProviderStderr }) {
  logExecutionFlow('runSwarmIteration', 'input', `taskId=${taskId}, prompt=${Boolean(prompt)}`);
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

  logExecutionFlow('runSwarmIteration', 'processing', `providers=${providers.join(',')}`);
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
      // The agent already receives full task context via --cloud-task; keep the per-iteration
      // prompt narrowly scoped to the next instruction to avoid duplicating context.
      args.push('--prompt', String(prompt));
    }

    return pRetryFn(
      () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
        onStdout: (data) => {
          if (typeof onProviderStdout === 'function') onProviderStdout(provider, data);
          logger?.log('output', data);
        },
        onStderr: (data) => {
          if (typeof onProviderStderr === 'function') onProviderStderr(provider, data);
          logger?.log('error', data);
        },
        onTrace: (event) => {
          void artifacts?.recordEngineTrace?.({ provider, model: swarmModels.length ? (swarmModels[index]?.model || null) : null, role: 'swarm-iteration' }, event);

          if (taskId) {
            if (event.phase === 'start' && event.pid) {
              void updateCloudTask(taskId, { pid: event.pid, started_at: event.started_at });
            }
            if (event.phase === 'exit') {
              void updateCloudTask(taskId, { exit_code: event.exit_code, completed_at: event.finished_at });
            }
          }
        }
        ,
        cancellationWatcher,
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

  logExecutionFlow('runSwarmIteration', 'output', `providers finished count=${results.length}`);
  return results;
}

async function runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr, artifacts, cancellationWatcher }) {
  logExecutionFlow('runSingleAgentIteration', 'input', `taskId=${taskId}, provider=${provider}, model=${model}, prompt=${Boolean(prompt) ? 'present' : 'none'}`);
  logExecutionFlow('runSingleAgentIteration', 'processing', 'preparing runAgxCommand');
  const args = [provider, '--cloud-task', taskId];
  if (model) {
    args.push('--model', model);
  }

  // Record iteration prompt for artifacts
  // For iteration 1, prompt is empty because context comes via --cloud-task
  // For subsequent iterations, prompt contains the next_prompt from aggregation
  const iterationLabel = `Agent Iteration Prompt (${provider}${model ? `/${model}` : ''})`;
  if (prompt) {
    const iterPrompt = String(prompt);
    artifacts?.recordPrompt(iterationLabel, iterPrompt);
    args.push('--prompt', iterPrompt);
  } else {
    // First iteration uses --cloud-task context (already recorded as Initial Task Context)
    artifacts?.recordPrompt(iterationLabel, `(First iteration: using --cloud-task ${taskId} context)`);
  }


  await abortIfCancelled(cancellationWatcher);
  const res = await pRetryFn(
    () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
      onStdout: (data) => {
        if (onStdout) onStdout(data);
        logger?.log('output', data);
      },
      onStderr: (data) => {
        if (onStderr) onStderr(data);
        logger?.log('error', data);
      },
      onTrace: (event) => {
        void artifacts?.recordEngineTrace?.({ provider, model: model || null, role: 'single-iteration' }, event);

        if (taskId) {
          if (event.phase === 'start' && event.pid) {
            void updateCloudTask(taskId, { pid: event.pid, started_at: event.started_at });
          }
          if (event.phase === 'exit') {
            void updateCloudTask(taskId, { exit_code: event.exit_code, completed_at: event.finished_at });
          }
        }
      },
      cancellationWatcher,
    }),
    { retries: SWARM_RETRIES }
  );

  const outputSource = res.stdout || res.stderr || '';
  logExecutionFlow('runSingleAgentIteration', 'output', `response length=${outputSource.length}`);
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

/**
 * Build the common aggregator prompt structure.
 * @param {object} params
 * @param {string} params.role - e.g. 'single-agent' or 'swarm'
 * @param {string} params.taskId
 * @param {object} params.task
 * @param {string} params.stagePrompt
 * @param {string} params.stageRequirement
 * @param {string|null} params.runPath - local run folder containing artifacts (when available)
 * @param {string[]} params.fileRefs - absolute file refs detected from agent output/logs
 * @returns {string}
 */
function buildAggregatorPrompt({ role, taskId, task, stagePrompt, stageRequirement, runPath, fileRefs }) {
  const taskComments = task?.comments || [];
  const refs = Array.isArray(fileRefs) ? fileRefs.filter(Boolean).slice(0, 20) : [];
  const refsBlock = refs.length ? refs.map((p) => `- ${p}`).join('\n') : '- (none detected)';
  const runRoot = runPath ? String(runPath) : '';
  const runFiles = runRoot
    ? [
      `- ${path.join(runRoot, 'output.md')} (agent output)`,
      `- ${path.join(runRoot, 'prompt.md')} (prompts captured during the run)`,
      `- ${path.join(runRoot, 'decision.json')} (final decision payload)`,
      `- ${path.join(runRoot, 'events.ndjson')} (engine trace + run events)`,
      `- ${path.join(runRoot, 'artifacts')} (additional artifacts, if any)`,
    ].join('\n')
    : [
      '- output.md (agent output)',
      '- prompt.md (prompts captured during the run)',
      '- decision.json (final decision payload)',
      '- events.ndjson (engine trace + run events)',
      '- artifacts/ (additional artifacts, if any)',
    ].join('\n');

  return `You are the decision aggregator for a ${role} run.

Task ID: ${taskId}
Title: ${task?.title || taskId}
Stage: ${task?.stage || 'unknown'}

User Request: 
"""
${task?.title}
${task?.content}
---
Task Thread:
${taskComments.map(c => `${c.author}: ${c.content}`).join('\n')}
"""

Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}

Local run artifacts folder: ${runRoot || '(not available)'}
Key run files:
${runFiles}

Relevant files referenced during execution (detected from output/logs):
${refsBlock}

Decide if the task is done. If not, provide the next instruction for another iteration.
Only set "done": true when the Stage Completion Requirement is satisfied.

You may think through your analysis first, but you MUST end your response with valid JSON.

Output contract (strict):
- You may include thinking/reasoning at the start of your response
- Your response MUST end with exactly one raw JSON object
- Do not use markdown/code fences/backticks around the JSON
- Do not add commentary after the JSON
- Use double-quoted keys and strings
- Keep newlines escaped inside strings
- If "done" is false, "next_prompt" must be a non-empty actionable instruction

The final JSON in your response must have this exact shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state"
}

If uncertain, still return valid JSON with decision "failed" and explain why in "explanation".
`;
}

async function runSingleAgentAggregate({ task, taskId, prompt, output, iteration, logger, provider, model, artifacts, cancellationWatcher }) {
  logExecutionFlow('runSingleAgentAggregate', 'input', `taskId=${taskId}, iteration=${iteration}`);
  logExecutionFlow('runSingleAgentAggregate', 'processing', 'running aggregator');
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
  const aggregatorProvider = String(provider || task?.provider || task?.engine || 'claude').toLowerCase();
  const aggregatorModel = typeof model === 'string' && model.trim() ? model.trim() : null;
  const fileRefs = extractFileRefsFromText(output, { max: 20 });

  const aggregatePrompt = buildAggregatorPrompt({
    role: 'single-agent',
    taskId,
    task,
    stagePrompt,
    stageRequirement,
    runPath: artifacts?.runPath || null,
    fileRefs,
  });
  artifacts?.recordPrompt(`Aggregator Prompt (${aggregatorProvider}${aggregatorModel ? `/${aggregatorModel}` : ''})`, aggregatePrompt);

  const aggregateArgs = [aggregatorProvider, '--prompt', aggregatePrompt, '--print'];
  if (aggregatorModel) {
    aggregateArgs.push('--model', aggregatorModel);
  }

  await abortIfCancelled(cancellationWatcher);
  const res = await pRetryFn(
    () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
      onStdout: (data) => logger?.log('checkpoint', data),
      onStderr: (data) => logger?.log('error', data),
      onTrace: (event) => {
        void artifacts?.recordEngineTrace?.({ provider: aggregatorProvider, model: aggregatorModel || null, role: 'single-aggregate' }, event);
      },
      cancellationWatcher,
    }),
    { retries: SWARM_RETRIES }
  );

  const decision = extractJson(res.stdout) || extractJson(res.stderr);
  logExecutionFlow('runSingleAgentAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
  if (!decision) {
    logger?.log('error', '[single] Aggregator returned invalid JSON\n');
    return { done: true, decision: 'failed', explanation: 'Aggregator response was not valid JSON.', final_result: 'Aggregator response was not valid JSON.', next_prompt: '', summary: 'Aggregator response was not valid JSON.' };
  }

  logger?.log('checkpoint', `[single] decision ${JSON.stringify(decision)}\n`);

  return ensureExplanation(enforceStageRequirement({
    done: Boolean(decision.done),
    decision: typeof decision.decision === 'string' ? decision.decision : '',
    explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
    final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
    next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
    summary: typeof decision.summary === 'string' ? decision.summary : ''
  }, { stage: stageKey, stagePrompt }));
}

async function runSingleAgentLoop({ taskId, task, provider, model, logger, onStdout, onStderr, artifacts, cancellationWatcher }) {
  logExecutionFlow('runSingleAgentLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}`);
  let iteration = 1;
  let prompt = '';
  let lastDecision = null;

  while (iteration <= 2) {
    logExecutionFlow('runSingleAgentLoop', 'processing', `iteration ${iteration} start`);
    logger?.log('system', `[single] iteration ${iteration} start\n`);
    if (iteration === 1) {
      console.log(`${c.dim}[single] Starting single-agent run...${c.reset}`);
    }
    let output = '';
    await abortIfCancelled(cancellationWatcher);
    try {
      output = await runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr, artifacts, cancellationWatcher });
      await abortIfCancelled(cancellationWatcher);
      artifacts?.recordOutput(`Agent Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, output);

      // Do not remove this part
      // Get the last part of the output
      const finalComment = truncateForComment(cleanAgentOutputForComment(output));

      // Post as comment to the task
      await postTaskComment(taskId, finalComment);

    } catch (err) {
      if (err instanceof CancellationRequestedError) {
        throw err;
      }
      const message = err?.stdout || err?.stderr || err?.message || 'Single-agent run failed.';
      console.log(`${c.red}[single] Failed: ${err?.message || 'Single-agent run failed.'}${c.reset}`);
      logExecutionFlow('runSingleAgentLoop', 'output', `iteration ${iteration} failed ${err?.message || 'run failed'}`);
      lastDecision = {
        decision: 'failed',
        explanation: err?.message || 'Single-agent run failed.',
        final_result: message,
        summary: err?.message || 'Single-agent run failed.',
        done: false
      };
      return { code: 1, decision: lastDecision };
    }

    const decision = ensureExplanation(ensureNextPrompt(
      await runSingleAgentAggregate({
        task,
        taskId,
        prompt,
        output,
        iteration,
        logger,
        provider,
        model,
        artifacts,
        cancellationWatcher,
      })
    ));

    console.log(JSON.stringify(decision, null, 2));
    lastDecision = decision;

    // Post as comment to the task
    await postTaskComment(taskId, decision.summary);

    if (decision.summary) {
      console.log(`${c.dim}[single] Decision: ${decision.summary}${c.reset}`);
    }
    logExecutionFlow('runSingleAgentLoop', 'output', `decision ${iteration} ${decision.decision}`);

    if (['done', 'blocked'].includes(decision.decision)) {
      logExecutionFlow('runSingleAgentLoop', 'output', `done at iteration ${iteration}`);
      return { code: 0, decision: lastDecision };
    }

    prompt = buildNextPromptWithDecisionContext(decision);
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

function truncateForPrompt(text, maxChars) {
  const value = String(text || '');
  const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 6000;
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}\n[truncated]`;
}

function buildExecuteIterationPrompt(nextPrompt, iteration) {
  const instruction = typeof nextPrompt === 'string' && nextPrompt.trim()
    ? nextPrompt.trim()
    : 'Pick the next concrete step and implement it.';

  return [
    'EXECUTE PHASE',
    `Iteration: ${iteration}`,
    '',
    'Keep output concise and avoid dumping full file contents or long logs.',
    'If you need to reference code, cite paths and describe changes instead of pasting whole files.',
    '',
    'Output contract:',
    '- Start with "PLAN:" then 2-5 bullets.',
    '- Do the work.',
    '- End with "IMPLEMENTATION SUMMARY:" bullets:',
    '  - Changed: (paths only, 10 max)',
    '  - Commands: (what you ran)',
    '  - Notes:',
    '',
    `Task for this iteration: ${instruction}`,
    '',
    'Do not output JSON in this phase.',
    ''
  ].join('\n');
}

function buildVerifyPrompt({ taskId, task, stagePrompt, stageRequirement, gitSummary, verifyResults, iteration, lastRunPath }) {
  const title = String(task?.title || taskId || '').trim();
  const contentRaw = String(task?.content || '').trim();
  const content = contentRaw.length > 2500 ? `${contentRaw.slice(0, 2500)}\n[truncated]` : contentRaw;

  const diffStat = gitSummary?.diff_stat ? String(gitSummary.diff_stat).trim() : '';
  const statusPorcelain = gitSummary?.status_porcelain ? String(gitSummary.status_porcelain).trim() : '';
  const statusShort = statusPorcelain ? statusPorcelain.split('\n').slice(0, 80).join('\n') : '';
  const diffShort = diffStat ? diffStat.split('\n').slice(0, 60).join('\n') : '';

  const commands = Array.isArray(verifyResults) ? verifyResults : [];
  const cmdLines = commands.length
    ? commands.map((r) => {
      const code = typeof r.exit_code === 'number' ? r.exit_code : null;
      const label = r.label || `${r.cmd} ${(r.args || []).join(' ')}`.trim();
      const dur = typeof r.duration_ms === 'number' ? `${r.duration_ms}ms` : '';
      return `- ${label} => exit=${code} ${dur}`.trim();
    }).join('\n')
    : '- (no verification commands detected)';

  const runRoot = lastRunPath ? String(lastRunPath) : '';

  const prompt = `You are the verifier for an agx run.

Task ID: ${taskId}
Title: ${title || taskId}
Stage: ${task?.stage || 'unknown'}
Iteration: ${iteration}

Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}

Local run artifacts folder: ${runRoot || '(not available)'}

User Request:
"""
${title}
${content}
"""

Repo summary (git):
Status (porcelain):
${statusShort || '(none)'}

Diff (stat):
${diffShort || '(none)'}

Verification commands:
${cmdLines}

Decide if the stage is complete. Use verification commands as evidence.
Ignore unrelated working tree changes; focus on whether the user request is satisfied.
If not complete, provide the next smallest instruction for another iteration.
Set "done": true when the user request is satisfied and the evidence supports it. Treat the stage objective/requirement as guidance, not a keyword checklist.

Output contract (strict): your response MUST be exactly one raw JSON object with this shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state",
  "plan_md": "PLAN markdown for this iteration (newlines escaped)",
  "implementation_summary_md": "IMPLEMENTATION SUMMARY markdown (newlines escaped)",
  "verification_md": "VERIFICATION markdown (newlines escaped)"
}

Rules:
- Use double-quoted keys and strings.
- Keep newlines escaped inside strings (use \\n).
- Keep the markdown fields short and checklist-style.
- Always fill "explanation". For "blocked", include what is blocking and what input/action would unblock. For "failed", include what failed (command/tool/error) and a recovery step.
`;

  return truncateForPrompt(prompt, VERIFY_PROMPT_MAX_CHARS);
}

async function persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision, verifyCommands, verifyResults, gitSummary }) {
  if (!storage) return;

  const safeText = (v) => (typeof v === 'string' ? v : '');

  // Ensure the run container has a plan folder so the layout is always:
  //   <task_slug>/<run_id>/{plan,execute,verify}
  if (runContainerPath) {
    try {
      await fs.promises.mkdir(path.join(runContainerPath, 'plan'), { recursive: true });
    } catch { }
  }

  const planMd = safeText(decision?.plan_md) || '# Plan\n\n- (not provided)\n';
  const implMd = safeText(decision?.implementation_summary_md) || '# Implementation Summary\n\n- (not provided)\n';
  const verificationMd = safeText(decision?.verification_md) || '# Verification\n\nDONE: no\n\n- (not provided)\n';

  // Write the plan markdown into the plan folder (not under execute/verify).
  if (runContainerPath) {
    try {
      await fs.promises.writeFile(path.join(runContainerPath, 'plan', 'plan.md'), planMd.endsWith('\n') ? planMd : `${planMd}\n`, 'utf8');
    } catch { }
  }

  // Implementation summary belongs with the execution phase.
  if (executeRun?.paths?.artifacts) {
    try {
      await storage.writeArtifact(executeRun, 'implementation_summary.md', implMd.endsWith('\n') ? implMd : `${implMd}\n`);
    } catch (err) {
      await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] execute artifact write failed: ${err?.message || err}`);
    }
  }

  // Verification outputs (including command logs) belong with the verify phase.
  if (verifyRun?.paths?.artifacts) {
    try {
      await storage.writeArtifact(verifyRun, 'verification.md', verificationMd.endsWith('\n') ? verificationMd : `${verificationMd}\n`);
    } catch (err) {
      await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] verify artifact write failed (verification.md): ${err?.message || err}`);
    }

    const payload = {
      commands: Array.isArray(verifyCommands) ? verifyCommands : [],
      results: Array.isArray(verifyResults) ? verifyResults.map((r) => ({
        id: r.id,
        label: r.label,
        cmd: r.cmd,
        args: r.args,
        cwd: r.cwd,
        exit_code: r.exit_code,
        duration_ms: r.duration_ms,
        error: r.error,
      })) : [],
      git: gitSummary || null,
    };

    try {
      await storage.writeArtifact(verifyRun, 'verify_commands.json', JSON.stringify(payload, null, 2) + '\n');
    } catch (err) {
      await appendRunContainerLog(runContainerPath, 'daemon/artifact_errors.log', `[${new Date().toISOString()}] verify artifact write failed (verify_commands.json): ${err?.message || err}`);
    }

    if (Array.isArray(verifyResults)) {
      for (let i = 0; i < verifyResults.length; i += 1) {
        const r = verifyResults[i];
        const base = `verify_results/${String(i + 1).padStart(2, '0')}-${String(r.id || `cmd_${i + 1}`).replace(/[^a-z0-9_-]/gi, '_')}`;
        try { await storage.writeArtifact(verifyRun, `${base}.stdout.txt`, (r.stdout || '').toString()); } catch { }
        try { await storage.writeArtifact(verifyRun, `${base}.stderr.txt`, (r.stderr || '').toString()); } catch { }
      }
    }

    if (gitSummary?.status_porcelain) {
      try { await storage.writeArtifact(verifyRun, 'git_status.txt', String(gitSummary.status_porcelain)); } catch { }
    }
    if (gitSummary?.diff_stat) {
      try { await storage.writeArtifact(verifyRun, 'git_diffstat.txt', String(gitSummary.diff_stat)); } catch { }
    }
  }
}

async function appendRunContainerLog(runContainerPath, relativePath, text) {
  if (!runContainerPath || !relativePath || !text) return;
  const filePath = path.join(runContainerPath, relativePath);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const payload = String(text);
    await fs.promises.appendFile(filePath, payload.endsWith('\n') ? payload : `${payload}\n`, 'utf8');
  } catch { }
}

async function finalizeRunSafe(storage, run, decision) {
  if (!storage || !run || run.finalized) return;
  try {
    await storage.finalizeRun(run, decision);
  } catch { }
}

async function runSingleAgentExecuteVerifyLoop({ taskId, task, provider, model, logger, storage, projectSlug, taskSlug, stageLocal, initialPromptContext, cancellationWatcher }) {
  logExecutionFlow('runSingleAgentExecuteVerifyLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}`);
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

  let iteration = 1;
  let nextPrompt = '';
  let lastDecision = null;
  let lastRun = null;
  let lastRunEntry = null;

  while (iteration <= SINGLE_MAX_ITERS) {
    logger?.log('system', `[single] execute/verify iteration ${iteration} start\n`);
    logExecutionFlow('runSingleAgentExecuteVerifyLoop', 'processing', `iteration ${iteration} start`);
    await abortIfCancelled(cancellationWatcher);

    const executeRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: stageLocal,
      engine: provider,
      model: model || undefined,
    });
    lastRun = executeRun;
    const runContainerPath = executeRun?.paths?.root ? path.dirname(executeRun.paths.root) : null;

	    const executeArtifacts = createDaemonArtifactsRecorder({ storage, run: executeRun, taskId });
	    if (iteration === 1 && initialPromptContext) {
	      executeArtifacts.recordPrompt('Initial Task Context', initialPromptContext);
	    }

	    // Tee spawned agx output into files under execute artifacts.
	    const execStdoutPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stdout.log') : null;
	    const execStderrPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stderr.log') : null;
	    const execStdoutStream = execStdoutPath ? fs.createWriteStream(execStdoutPath, { flags: 'a' }) : null;
	    const execStderrStream = execStderrPath ? fs.createWriteStream(execStderrPath, { flags: 'a' }) : null;

	    // EXECUTE
	    const executePrompt = buildExecuteIterationPrompt(nextPrompt, iteration);
	    let output = '';
	    try {
	      output = await runSingleAgentIteration({
        taskId,
        task,
        provider,
	        model,
	        prompt: executePrompt,
	        logger,
	        onStdout: (chunk) => {
	          try { execStdoutStream?.write(chunk.toString()); } catch { }
	        },
	        onStderr: (chunk) => {
	          try { execStderrStream?.write(chunk.toString()); } catch { }
	        },
	        artifacts: executeArtifacts,
	        cancellationWatcher,
	      });
	    } catch (err) {
	      const message = err?.stdout || err?.stderr || err?.message || 'Single-agent execute phase failed.';
	      executeArtifacts.recordOutput('Execute Error', String(message));
	      await executeArtifacts.flush();
	      try { execStdoutStream?.end(); } catch { }
	      try { execStderrStream?.end(); } catch { }
	      await storage.failRun(executeRun, { error: err?.message || 'execute failed', code: 'EXECUTE_FAILED' });
	      lastDecision = {
        done: false,
        decision: 'failed',
        explanation: err?.message || 'Single-agent execute phase failed.',
        final_result: message,
        next_prompt: '',
        summary: err?.message || 'Single-agent execute phase failed.',
	      };
	      return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
	    }
	    try { execStdoutStream?.end(); } catch { }
	    try { execStderrStream?.end(); } catch { }
	    executeArtifacts.recordOutput(`Agent Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, output);
	    await executeArtifacts.flush();

	    // VERIFY (local commands)
	    const verifyCommands = detectVerifyCommands({ cwd: process.cwd() });
    const gitSummary = getGitSummary({ cwd: process.cwd() });
    const verifyResults = await runVerifyCommands(verifyCommands, { cwd: process.cwd(), max_output_chars: 20000 });

	    const verifyRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: 'verify',
      runId: executeRun.run_id,
      engine: provider,
      model: model || undefined,
    });
	    lastRun = verifyRun;

	    // Tee verifier stdout/stderr to files under verify artifacts.
	    const verifyStdoutPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stdout.log') : null;
	    const verifyStderrPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stderr.log') : null;
	    const verifyStdoutStream = verifyStdoutPath ? fs.createWriteStream(verifyStdoutPath, { flags: 'a' }) : null;
	    const verifyStderrStream = verifyStderrPath ? fs.createWriteStream(verifyStderrPath, { flags: 'a' }) : null;

	    // VERIFY (LLM)
	    const verifyPrompt = buildVerifyPrompt({
      taskId,
      task,
      stagePrompt,
      stageRequirement,
      gitSummary,
      verifyResults,
      iteration,
      lastRunPath: runContainerPath || verifyRun?.paths?.root || null,
    });
    const verifyArtifacts = createDaemonArtifactsRecorder({ storage, run: verifyRun, taskId });
    verifyArtifacts.recordPrompt(`Verification Prompt (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, verifyPrompt);

    const verifyArgs = [provider, '--prompt', verifyPrompt, '--print'];
    if (model) verifyArgs.push('--model', model);

    await abortIfCancelled(cancellationWatcher);

	    let verifyRes;
	    try {
	      verifyRes = await pRetryFn(
	        () => runAgxCommand(verifyArgs, VERIFY_TIMEOUT_MS, `agx ${provider} verify`, {
	          onStdout: (data) => {
	            try { verifyStdoutStream?.write(data.toString()); } catch { }
	            logger?.log('checkpoint', data);
	          },
	          onStderr: (data) => {
	            try { verifyStderrStream?.write(data.toString()); } catch { }
	            logger?.log('error', data);
	          },
	          onTrace: (event) => {
	            void verifyArtifacts?.recordEngineTrace?.({ provider, model: model || null, role: 'single-verify' }, event);
	          },
	          cancellationWatcher,
	        }),
	        { retries: SWARM_RETRIES }
	      );
		    } catch (err) {
		      try { verifyStdoutStream?.end(); } catch { }
		      try { verifyStderrStream?.end(); } catch { }
		      if (err instanceof CancellationRequestedError) {
		        throw err;
		      }
		      verifyArtifacts.recordOutput('Verifier Error', String(err?.message || err));
		      await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision: {}, verifyCommands, verifyResults, gitSummary });
		      await verifyArtifacts.flush();
		      await storage.failRun(verifyRun, { error: err?.message || 'verify failed', code: 'VERIFY_FAILED' });
		      await finalizeRunSafe(storage, executeRun, { status: 'failed', reason: `Verification failed: ${err?.message || 'verify failed'}` });
		      lastDecision = {
		        done: false,
		        decision: 'failed',
		        explanation: err?.message || 'Verifier failed.',
		        final_result: err?.message || 'Verifier failed.',
	        next_prompt: '',
	        summary: err?.message || 'Verifier failed.',
		      };
		      return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
		    }
	    try { verifyStdoutStream?.end(); } catch { }
	    try { verifyStderrStream?.end(); } catch { }

	    const verifierText = verifyRes?.stdout || verifyRes?.stderr || '';
	    verifyArtifacts.recordOutput(`Verifier Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, verifierText);

    let decision = extractJsonLast(verifierText);
    if (!decision) decision = extractJsonLast(verifyRes?.stderr || '');
    if (!decision) {
      decision = {
        done: false,
        decision: 'failed',
        explanation: 'Verifier returned invalid JSON.',
        final_result: 'Verifier returned invalid JSON.',
        next_prompt: '',
        summary: 'Verifier returned invalid JSON.',
      };
    }

    decision = ensureExplanation(ensureNextPrompt(enforceStageRequirement({
      done: Boolean(decision.done),
      decision: typeof decision.decision === 'string' ? decision.decision : '',
      explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
      final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
      next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
      summary: typeof decision.summary === 'string' ? decision.summary : '',
      plan_md: typeof decision.plan_md === 'string' ? decision.plan_md : '',
      implementation_summary_md: typeof decision.implementation_summary_md === 'string' ? decision.implementation_summary_md : '',
      verification_md: typeof decision.verification_md === 'string' ? decision.verification_md : '',
    }, { stage: stageKey, stagePrompt })));

	    lastDecision = decision;

	    await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision, verifyCommands, verifyResults, gitSummary });

	    // Finalize this iteration (verify) run.
	    verifyArtifacts.recordOutput('Daemon Decision', JSON.stringify(decision || {}, null, 2));
	    await verifyArtifacts.flush();

		    const statusMap = {
		      done: 'done',
		      blocked: 'blocked',
		      not_done: 'continue',
		      failed: 'failed',
		    };
		    const localDecisionStatus = statusMap[String(decision?.decision || 'failed')] || 'failed';
		    await finalizeRunSafe(storage, executeRun, {
		      status: localDecisionStatus,
		      reason: 'Execute phase completed; see verify stage for decision.',
		    });
		    await storage.finalizeRun(verifyRun, {
		      status: localDecisionStatus,
		      reason: decision?.explanation || decision?.summary || '',
		    });

	    lastRunEntry = await buildLocalRunIndexEntry(storage, verifyRun, localDecisionStatus);

    // Update local task status.
    const localTaskStatusMap = {
      done: 'done',
      blocked: 'blocked',
      not_done: 'running',
      failed: 'failed',
    };
    const nextLocalStatus = localTaskStatusMap[String(decision?.decision || 'failed')] || 'failed';
    await storage.updateTaskState(projectSlug, taskSlug, { status: nextLocalStatus });

    await postTaskComment(taskId, decision.summary || decision.explanation || '');

    if (['done', 'blocked', 'failed'].includes(String(decision?.decision || ''))) {
      const code = decision?.decision === 'done' ? 0 : 1;
      return { code, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
    }

    nextPrompt = buildNextPromptWithDecisionContext(decision);
    iteration += 1;
  }

  if (!lastDecision) {
    lastDecision = {
      done: false,
      decision: 'not_done',
      explanation: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
      final_result: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
      next_prompt: '',
      summary: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
    };
  }

  return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
}

async function runSwarmExecuteVerifyLoop({ taskId, task, logger, storage, projectSlug, taskSlug, stageLocal, initialPromptContext, cancellationWatcher }) {
  logExecutionFlow('runSwarmExecuteVerifyLoop', 'input', `taskId=${taskId}`);
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

  let iteration = 1;
  let nextPrompt = '';
  let lastDecision = null;
  let lastRun = null;
  let lastRunEntry = null;

  const verifierProvider = String(task?.engine || task?.provider || 'claude').toLowerCase();
  const verifierModel = resolveAggregatorModel(task);

  while (iteration <= SWARM_MAX_ITERS) {
    logger?.log('system', `[swarm] execute/verify iteration ${iteration} start\n`);
    await abortIfCancelled(cancellationWatcher);

    const executeRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: stageLocal,
      engine: verifierProvider,
      model: verifierModel || undefined,
    });
    lastRun = executeRun;
    const runContainerPath = executeRun?.paths?.root ? path.dirname(executeRun.paths.root) : null;

    const executeArtifacts = createDaemonArtifactsRecorder({ storage, run: executeRun, taskId });
    if (iteration === 1 && initialPromptContext) {
      executeArtifacts.recordPrompt('Initial Task Context', initialPromptContext);
    }

    // Tee spawned agx output into files under execute artifacts.
    const execStdoutPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stdout.log') : null;
    const execStderrPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stderr.log') : null;
    const execStdoutStream = execStdoutPath ? fs.createWriteStream(execStdoutPath, { flags: 'a' }) : null;
    const execStderrStream = execStderrPath ? fs.createWriteStream(execStderrPath, { flags: 'a' }) : null;

    // EXECUTE (swarm iteration)
    let results;
    try {
      results = await runSwarmIteration({
        taskId,
        task,
        prompt: nextPrompt ? buildExecuteIterationPrompt(nextPrompt, iteration) : buildExecuteIterationPrompt('', iteration),
        logger,
        artifacts: executeArtifacts,
        cancellationWatcher,
        onProviderStdout: (provider, chunk) => {
          if (!execStdoutStream) return;
          execStdoutStream.write(`[${provider}] ${chunk.toString()}`);
        },
        onProviderStderr: (provider, chunk) => {
          if (!execStderrStream) return;
          execStderrStream.write(`[${provider}] ${chunk.toString()}`);
        },
      });
    } catch (err) {
      executeArtifacts.recordOutput('Execute Error', String(err?.message || err));
      await executeArtifacts.flush();
      try { execStdoutStream?.end(); } catch { }
      try { execStderrStream?.end(); } catch { }
      await storage.failRun(executeRun, { error: err?.message || 'swarm execute failed', code: 'EXECUTE_FAILED' });
      lastDecision = {
        done: false,
        decision: 'failed',
        explanation: err?.message || 'Swarm execute phase failed.',
        final_result: err?.message || 'Swarm execute phase failed.',
        next_prompt: '',
        summary: err?.message || 'Swarm execute phase failed.',
      };
      return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
    } finally {
      try { execStdoutStream?.end(); } catch { }
      try { execStderrStream?.end(); } catch { }
    }

    const combinedOutput = Array.isArray(results)
      ? results.map((r) => `[${r.provider}]\n${r.output || ''}`).join('\n\n')
      : '';
    executeArtifacts.recordOutput(`Swarm Output (iter ${iteration})`, combinedOutput);
    await executeArtifacts.flush();

    // VERIFY (local commands)
    const verifyCommands = detectVerifyCommands({ cwd: process.cwd() });
    const gitSummary = getGitSummary({ cwd: process.cwd() });
    const verifyResults = await runVerifyCommands(verifyCommands, { cwd: process.cwd(), max_output_chars: 20000 });

    const verifyRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: 'verify',
      runId: executeRun.run_id,
      engine: verifierProvider,
      model: verifierModel || undefined,
    });
    lastRun = verifyRun;

    // Tee verifier stdout/stderr to files under verify artifacts.
    const verifyStdoutPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stdout.log') : null;
    const verifyStderrPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stderr.log') : null;
    const verifyStdoutStream = verifyStdoutPath ? fs.createWriteStream(verifyStdoutPath, { flags: 'a' }) : null;
    const verifyStderrStream = verifyStderrPath ? fs.createWriteStream(verifyStderrPath, { flags: 'a' }) : null;

    // VERIFY (LLM)
    const verifyPrompt = buildVerifyPrompt({
      taskId,
      task,
      stagePrompt,
      stageRequirement,
      gitSummary,
      verifyResults,
      iteration,
      lastRunPath: runContainerPath || verifyRun?.paths?.root || null,
    });
    const verifyArtifacts = createDaemonArtifactsRecorder({ storage, run: verifyRun, taskId });
    verifyArtifacts.recordPrompt(`Verification Prompt (${verifierProvider}${verifierModel ? `/${verifierModel}` : ''}, iter ${iteration})`, verifyPrompt);

    const verifyArgs = [verifierProvider, '--prompt', verifyPrompt, '--print'];
    if (verifierModel) verifyArgs.push('--model', verifierModel);

    let verifyRes;
    try {
      await abortIfCancelled(cancellationWatcher);
      verifyRes = await pRetryFn(
        () => runAgxCommand(verifyArgs, VERIFY_TIMEOUT_MS, `agx ${verifierProvider} verify`, {
          onStdout: (data) => {
            try { verifyStdoutStream?.write(data.toString()); } catch { }
            logger?.log('checkpoint', data);
          },
          onStderr: (data) => {
            try { verifyStderrStream?.write(data.toString()); } catch { }
            logger?.log('error', data);
          },
          onTrace: (event) => {
            void verifyArtifacts?.recordEngineTrace?.({ provider: verifierProvider, model: verifierModel || null, role: 'swarm-verify' }, event);
            void signalTemporalTask(taskId, 'daemonStep', {
              kind: 'runAgxCommand',
              task_id: taskId,
              provider: verifierProvider,
              model: verifierModel || null,
              role: 'swarm-verify',
              iteration,
              ...event,
            });
          },
          cancellationWatcher,
        }),
        { retries: SWARM_RETRIES }
      );
	    } catch (err) {
	      verifyArtifacts.recordOutput('Verifier Error', String(err?.message || err));
	      await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision: {}, verifyCommands, verifyResults, gitSummary });
	      await verifyArtifacts.flush();
	      try { verifyStdoutStream?.end(); } catch { }
	      try { verifyStderrStream?.end(); } catch { }
	      await storage.failRun(verifyRun, { error: err?.message || 'verify failed', code: 'VERIFY_FAILED' });
	      await finalizeRunSafe(storage, executeRun, { status: 'failed', reason: `Verification failed: ${err?.message || 'verify failed'}` });
	      lastDecision = {
	        done: false,
	        decision: 'failed',
	        explanation: err?.message || 'Verifier failed.',
	        final_result: err?.message || 'Verifier failed.',
	        next_prompt: '',
	        summary: err?.message || 'Verifier failed.',
	      };
	      return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
	    } finally {
      try { verifyStdoutStream?.end(); } catch { }
      try { verifyStderrStream?.end(); } catch { }
    }

    const verifierText = verifyRes?.stdout || verifyRes?.stderr || '';
	    verifyArtifacts.recordOutput(`Verifier Output (${verifierProvider}${verifierModel ? `/${verifierModel}` : ''}, iter ${iteration})`, verifierText);

    let decision = extractJsonLast(verifierText);
    if (!decision) decision = extractJsonLast(verifyRes?.stderr || '');
    if (!decision) {
      decision = {
        done: false,
        decision: 'failed',
        explanation: 'Verifier returned invalid JSON.',
        final_result: 'Verifier returned invalid JSON.',
        next_prompt: '',
        summary: 'Verifier returned invalid JSON.',
      };
    }

    decision = ensureExplanation(ensureNextPrompt(enforceStageRequirement({
      done: Boolean(decision.done),
      decision: typeof decision.decision === 'string' ? decision.decision : '',
      explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
      final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
      next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
      summary: typeof decision.summary === 'string' ? decision.summary : '',
      plan_md: typeof decision.plan_md === 'string' ? decision.plan_md : '',
      implementation_summary_md: typeof decision.implementation_summary_md === 'string' ? decision.implementation_summary_md : '',
      verification_md: typeof decision.verification_md === 'string' ? decision.verification_md : '',
	    }, { stage: stageKey, stagePrompt })));
	
	    lastDecision = decision;
	    await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision, verifyCommands, verifyResults, gitSummary });
	
	    verifyArtifacts.recordOutput('Daemon Decision', JSON.stringify(decision || {}, null, 2));
	    await verifyArtifacts.flush();

		    const statusMap = {
		      done: 'done',
		      blocked: 'blocked',
		      not_done: 'continue',
		      failed: 'failed',
		    };
		    const localDecisionStatus = statusMap[String(decision?.decision || 'failed')] || 'failed';
		    await finalizeRunSafe(storage, executeRun, {
		      status: localDecisionStatus,
		      reason: 'Execute phase completed; see verify stage for decision.',
		    });
		    await storage.finalizeRun(verifyRun, {
		      status: localDecisionStatus,
		      reason: decision?.explanation || decision?.summary || '',
		    });
	
	    lastRunEntry = await buildLocalRunIndexEntry(storage, verifyRun, localDecisionStatus);

    const localTaskStatusMap = {
      done: 'done',
      blocked: 'blocked',
      not_done: 'running',
      failed: 'failed',
    };
    const nextLocalStatus = localTaskStatusMap[String(decision?.decision || 'failed')] || 'failed';
    await storage.updateTaskState(projectSlug, taskSlug, { status: nextLocalStatus });

    await postTaskComment(taskId, decision.summary || decision.explanation || '');

    if (['done', 'blocked', 'failed'].includes(String(decision?.decision || ''))) {
      const code = decision?.decision === 'done' ? 0 : 1;
      return { code, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
    }

	    nextPrompt = buildNextPromptWithDecisionContext(decision);
	    iteration += 1;
	  }

  if (!lastDecision) {
    lastDecision = {
      done: false,
      decision: 'not_done',
      explanation: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
      final_result: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
      next_prompt: '',
      summary: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
    };
  }

  return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
}

async function runSwarmAggregate({ task, taskId, prompt, results, iteration, logger, artifacts }) {
  const providerList = results.map((r) => r.provider).join(',');
  logExecutionFlow('runSwarmAggregate', 'input', `taskId=${taskId}, iteration=${iteration}, providers=${providerList}`);
  const stageKey = task?.stage || 'unknown';
  const stagePrompt = resolveStageObjective(task, stageKey, '');
  const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
  const aggregatorProvider = String(task?.engine || task?.provider || 'claude').toLowerCase();
  const aggregatorModel = resolveAggregatorModel(task);
  const fileRefs = extractFileRefsFromText(
    results.map((r) => r?.output || '').filter(Boolean).join('\n\n'),
    { max: 20 }
  );

  const aggregatePrompt = buildAggregatorPrompt({
    role: 'swarm',
    taskId,
    task,
    stagePrompt,
    stageRequirement,
    runPath: artifacts?.runPath || null,
    fileRefs,
  });
  artifacts?.recordPrompt(`Swarm Aggregator Prompt (${aggregatorProvider}${aggregatorModel ? `/${aggregatorModel}` : ''})`, aggregatePrompt);

  const aggregateArgs = [aggregatorProvider, '--prompt', aggregatePrompt, '--print'];
  if (aggregatorModel) {
    aggregateArgs.push('--model', aggregatorModel);
  }

  logExecutionFlow('runSwarmAggregate', 'processing', 'running aggregator');
  const res = await pRetryFn(
    () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
      onStdout: (data) => logger?.log('checkpoint', data),
      onStderr: (data) => logger?.log('error', data),
      onTrace: (event) => {
        void artifacts?.recordEngineTrace?.({ provider: aggregatorProvider, model: aggregatorModel || null, role: 'swarm-aggregate' }, event);
        void signalTemporalTask(taskId, 'daemonStep', {
          kind: 'runAgxCommand',
          task_id: taskId,
          provider: aggregatorProvider,
          model: aggregatorModel || null,
          role: 'swarm-aggregate',
          iteration,
          providers: results.map((r) => r.provider),
          ...event,
        });
      },
    }),
    { retries: SWARM_RETRIES }
  );

  const decision = extractJson(res.stdout) || extractJson(res.stderr);
  logExecutionFlow('runSwarmAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
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

async function runSwarmLoop({ taskId, task, artifacts, cancellationWatcher }) {
  logExecutionFlow('runSwarmLoop', 'input', `taskId=${taskId}`);
  let iteration = 1;
  let prompt = '';
  const logger = createTaskLogger(taskId);
  let lastDecision = null;

  await patchTaskState(taskId, { status: 'in_progress', started_at: new Date().toISOString() });
  logger.log('system', `[swarm] start ${new Date().toISOString()}\n`);

  try {
    while (iteration <= SWARM_MAX_ITERS) {
      logExecutionFlow('runSwarmLoop', 'processing', `starting iteration ${iteration}`);
      const results = await runSwarmIteration({ taskId, task, prompt, logger, artifacts, cancellationWatcher });
      if (Array.isArray(results)) {
        for (const r of results) {
          artifacts?.recordOutput(`Swarm Output (${r.provider}, iter ${iteration})`, r.output || '');
        }
      }
      const decision = ensureExplanation(ensureNextPrompt(
        await runSwarmAggregate({ task, taskId, prompt, results, iteration, logger, artifacts })
      ));
      lastDecision = decision;

      if (decision.summary) {
        console.log(`${c.dim}[swarm] ${decision.summary}${c.reset}`);
      }
      await postTaskComment(taskId, decision.summary);
      logExecutionFlow('runSwarmLoop', 'output', `iteration ${iteration} decision=${decision.decision}`);

      if (decision.done) {
        logExecutionFlow('runSwarmLoop', 'output', `done at iteration ${iteration}`);
        logger.log('system', `[swarm] done ${new Date().toISOString()}\n`);
        await logger.flushAll();
        await patchTaskState(taskId, { status: 'completed', completed_at: new Date().toISOString() });
        return { code: 0, decision: lastDecision };
      }

      prompt = buildNextPromptWithDecisionContext(decision);
      iteration += 1;
    }

    if (SWARM_MAX_ITERS > 0) {
      console.log(`${c.yellow}[swarm] Max iterations reached (${SWARM_MAX_ITERS}).${c.reset}`);
      logExecutionFlow('runSwarmLoop', 'output', `max iterations reached ${SWARM_MAX_ITERS}`);
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
    logExecutionFlow('runSwarmLoop', 'output', `failed ${err?.message || 'unknown'}`);
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
// Embedded orchestrator worker (pg-boss) runtime (optional). Keep legacy filenames for backward compatibility.
const WORKER_PID_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'orchestrator-worker.pid');
const WORKER_LOG_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'orchestrator-worker.log');
const PACKAGED_AGX_CLOUD_ROOT = path.join(__dirname, 'cloud-runtime', 'standalone');
// Legacy default path (only correct if the standalone build was traced under `/Users/<name>`).
const PACKAGED_AGX_CLOUD_DIR = path.join(PACKAGED_AGX_CLOUD_ROOT, 'Projects', 'Agents', 'agx-cloud');
const LOCAL_AGX_CLOUD_DIR = path.resolve(__dirname, '..', 'agx-cloud');
const TASK_LOGS_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx', 'logs');

let cachedPackagedAgxCloudDir;
function resolvePackagedAgxCloudDir() {
  if (cachedPackagedAgxCloudDir !== undefined) return cachedPackagedAgxCloudDir;

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  // Fast path: legacy location.
  if (hasFile(PACKAGED_AGX_CLOUD_DIR, 'server.js') && hasFile(PACKAGED_AGX_CLOUD_DIR, 'package.json')) {
    cachedPackagedAgxCloudDir = PACKAGED_AGX_CLOUD_DIR;
    return cachedPackagedAgxCloudDir;
  }

  // Next standalone output preserves part of the absolute path under `standalone/`,
  // so locate the app dir by scanning for `server.js`.
  const maxDepth = 8;
  const stack = [{ dir: PACKAGED_AGX_CLOUD_ROOT, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasServer = entries.some((e) => e.isFile() && e.name === 'server.js');
    const hasPkg = entries.some((e) => e.isFile() && e.name === 'package.json');
    if (hasServer && hasPkg) {
      cachedPackagedAgxCloudDir = dir;
      return cachedPackagedAgxCloudDir;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git') continue;
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }

  cachedPackagedAgxCloudDir = null;
  return cachedPackagedAgxCloudDir;
}

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

function resolveEmbeddedWorkerProjectDir() {
  // Allow explicit override for unusual setups.
  const override = process.env.AGX_CLOUD_WORKER_DIR;
  if (override && typeof override === 'string') {
    const resolved = path.resolve(override);
    try {
      if (fs.existsSync(path.join(resolved, 'package.json'))) return resolved;
    } catch { }
  }

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  const scoreCandidate = (dir) => {
    if (!dir) return -Infinity;
    if (!hasFile(dir, 'package.json')) return -Infinity;

    // The embedded worker needs actual source entrypoints; the packaged standalone runtime
    // often contains only `.next/` output and `server.js`, without `worker/`.
    const hasWorkerEntrypoint =
      hasFile(dir, path.join('worker', 'index.ts')) ||
      hasFile(dir, path.join('worker', 'index.js')) ||
      hasFile(dir, path.join('worker', 'index.mjs'));

    const hasTsx =
      hasFile(dir, path.join('node_modules', '.bin', 'tsx')) ||
      hasFile(dir, path.join('node_modules', 'tsx', 'dist', 'cli.mjs'));

    let score = 0;
    if (hasWorkerEntrypoint) score += 10;
    if (hasTsx) score += 3;

    // Prefer local dev checkout when present.
    if (path.resolve(dir) === path.resolve(LOCAL_AGX_CLOUD_DIR)) score += 5;

    // Penalize standalone runtime dir unless it actually contains a worker.
    if (path.resolve(dir) === path.resolve(PACKAGED_AGX_CLOUD_DIR) && !hasWorkerEntrypoint) score -= 5;
    return score;
  };

  // When agx is installed globally, LOCAL_AGX_CLOUD_DIR points into the global install prefix
  // and is usually not what a developer wants. Prefer a sibling checkout relative to the
  // current working directory when present (common monorepo layout).
  const CWD_AGX_CLOUD_DIR = path.resolve(process.cwd(), '..', 'agx-cloud');

  const packaged = resolvePackagedAgxCloudDir();
  const candidates = [CWD_AGX_CLOUD_DIR, LOCAL_AGX_CLOUD_DIR, packaged, PACKAGED_AGX_CLOUD_DIR].filter(Boolean);
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const s = scoreCandidate(candidate);
    if (s > bestScore) {
      bestScore = s;
      best = candidate;
    }
  }

  // If we only found a packaged runtime without a worker, treat as missing so we fail loudly.
  if (!best || bestScore < 1) return null;
  return best;
}

function isTemporalWorkerRunning() {
  const readPid = (pidFile) => {
    try {
      if (!fs.existsSync(pidFile)) return null;
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!pid) return null;
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  };

  return readPid(WORKER_PID_FILE) || false;
}

function pickEmbeddedWorkerNpmScript(projectDir) {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg?.scripts || {};
    if (scripts['daemon:worker']) return 'daemon:worker';
    if (scripts.worker) return 'worker';
  } catch { }
  return 'worker';
}

function loadEnvFile(envPath) {
  try {
    if (!envPath || !fs.existsSync(envPath)) return {};
    const raw = fs.readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      // Strip simple wrapping quotes.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function loadBoardEnv() {
  // agx board/runtime writes connection info here; used to start the embedded worker with correct DB config.
  return loadEnvFile(path.join(CONFIG_DIR, 'board.env'));
}

// ==================== BOARD (agx-cloud API server) ====================

const BOARD_PID_FILE = path.join(CONFIG_DIR, 'board.pid');
const BOARD_LOG_FILE = path.join(CONFIG_DIR, 'board.log');
const BOARD_ENV_FILE = path.join(CONFIG_DIR, 'board.env');

function isBoardRunning() {
  try {
    if (!fs.existsSync(BOARD_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(BOARD_PID_FILE, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

function resolveBoardDir() {
  const override = process.env.AGX_CLOUD_WORKER_DIR;
  if (override && typeof override === 'string') {
    const resolved = path.resolve(override);
    try {
      if (fs.existsSync(path.join(resolved, 'package.json'))) return { dir: resolved, mode: 'dev' };
    } catch { }
  }

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  // Dev mode: local sibling checkout
  const CWD_AGX_CLOUD_DIR = path.resolve(process.cwd(), '..', 'agx-cloud');
  for (const dir of [CWD_AGX_CLOUD_DIR, LOCAL_AGX_CLOUD_DIR]) {
    if (hasFile(dir, 'package.json')) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg?.scripts?.dev) return { dir, mode: 'dev' };
      } catch { }
    }
  }

  // Bundled mode: standalone server.js (location depends on output file tracing root).
  const packaged = resolvePackagedAgxCloudDir();
  if (packaged && hasFile(packaged, 'server.js')) {
    return { dir: packaged, mode: 'bundled' };
  }

  return null;
}

function getBoardPort() {
  // Extract port from cloud config apiUrl
  const apiUrl = process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741';
  try {
    const u = new URL(apiUrl);
    return parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return 41741;
  }
}

async function probeBoardHealth(port, timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://localhost:${port}/api/tasks`, {
      signal: controller.signal,
      headers: { 'x-user-id': '' },
    });
    clearTimeout(timer);
    return res.ok || res.status === 401; // 401 means server is up, just needs auth
  } catch {
    return false;
  }
}

async function ensurePostgresReady() {
  const boardEnv = loadBoardEnv();
  if (boardEnv.DATABASE_URL) {
    // Already configured — check if it's reachable
    try {
      const dbUrl = new URL(boardEnv.DATABASE_URL);
      const host = dbUrl.hostname;
      const port = dbUrl.port || '5432';
      const result = spawnSync('pg_isready', ['-h', host, '-p', port], { timeout: 3000 });
      if (result.status === 0) return boardEnv.DATABASE_URL;
    } catch { }
  }

  // Check if docker postgres is already running
  try {
    const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'agx-postgres'], { timeout: 3000 });
    if (result.stdout && result.stdout.toString().trim() === 'true') {
      const dbUrl = 'postgresql://agx:agx@localhost:55432/agx';
      saveBoardEnvValue('DATABASE_URL', dbUrl);
      return dbUrl;
    }
  } catch { }

  // Not reachable — prompt user
  console.log(`\n${c.yellow}Postgres is required for the agx board server.${c.reset}`);
  console.log(`  ${c.bold}1${c.reset}) Enter a custom DATABASE_URL`);
  console.log(`  ${c.bold}2${c.reset}) Auto-start postgres via Docker`);

  const answer = await prompt(`\n${c.cyan}Choice [2]:${c.reset} `);
  const choice = answer.trim() || '2';

  if (choice === '1') {
    const dbUrl = await prompt(`${c.cyan}DATABASE_URL:${c.reset} `);
    if (!dbUrl) {
      console.error(`${c.red}No DATABASE_URL provided.${c.reset}`);
      process.exit(1);
    }
    saveBoardEnvValue('DATABASE_URL', dbUrl);
    return dbUrl;
  }

  // Auto-start docker postgres
  console.log(`${c.dim}Starting postgres via Docker...${c.reset}`);
  const dockerResult = spawnSync('docker', [
    'run', '-d',
    '--name', 'agx-postgres',
    '-e', 'POSTGRES_DB=agx',
    '-e', 'POSTGRES_USER=agx',
    '-e', 'POSTGRES_PASSWORD=agx',
    '-p', '55432:5432',
    '-v', 'agx_pg_data:/var/lib/postgresql/data',
    'postgres:16-alpine',
  ], { stdio: 'pipe', timeout: 60000 });

  if (dockerResult.status !== 0) {
    const stderr = dockerResult.stderr ? dockerResult.stderr.toString() : '';
    // Container might already exist but be stopped
    if (stderr.includes('already in use')) {
      spawnSync('docker', ['start', 'agx-postgres'], { timeout: 10000 });
    } else {
      console.error(`${c.red}Failed to start postgres:${c.reset} ${stderr}`);
      process.exit(1);
    }
  }

  // Wait for postgres to be ready
  console.log(`${c.dim}Waiting for postgres to be ready...${c.reset}`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const check = spawnSync('docker', ['exec', 'agx-postgres', 'pg_isready', '-U', 'agx'], { timeout: 3000 });
    if (check.status === 0) break;
    await sleep(1000);
  }

  const dbUrl = 'postgresql://agx:agx@localhost:55432/agx';
  saveBoardEnvValue('DATABASE_URL', dbUrl);

  // Run init SQL
  const initSqlPath = path.join(__dirname, 'templates', 'stack', 'postgres', 'init', '001_agx_board_schema.sql');
  if (fs.existsSync(initSqlPath)) {
    console.log(`${c.dim}Initializing database schema...${c.reset}`);
    const initSql = fs.readFileSync(initSqlPath, 'utf8');
    const psqlResult = spawnSync('docker', [
      'exec', '-i', 'agx-postgres',
      'psql', '-U', 'agx', '-d', 'agx',
    ], { input: initSql, timeout: 10000 });
    if (psqlResult.status !== 0) {
      console.log(`${c.yellow}Schema init returned non-zero (may already exist)${c.reset}`);
    }
  }

  console.log(`${c.green}✓${c.reset} Postgres ready`);
  return dbUrl;
}

function saveBoardEnvValue(key, value) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadBoardEnv();
  existing[key] = value;
  const content = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(BOARD_ENV_FILE, content);
}

let _boardEnsured = false;

async function ensureBoardRunning() {
  if (_boardEnsured) return;
  _boardEnsured = true;

  // Only auto-start for local API URLs
  const apiUrl = process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741';
  try {
    const u = new URL(apiUrl);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.hostname !== '0.0.0.0' && u.hostname !== '::1') return;
  } catch { return; }

  const port = getBoardPort();

  // Quick probe — if already running, done
  if (await probeBoardHealth(port)) return;

  // Also check PID file
  const existingPid = isBoardRunning();
  if (existingPid && await probeBoardHealth(port)) return;

  // Clean stale PID
  if (existingPid) {
    try { fs.unlinkSync(BOARD_PID_FILE); } catch { }
  }

  console.log(`${c.dim}Board server not reachable at localhost:${port}, starting...${c.reset}`);

  // Ensure postgres
  const dbUrl = await ensurePostgresReady();

  // Resolve board directory
  const boardInfo = resolveBoardDir();
  if (!boardInfo) {
    console.error(`${c.red}Board runtime not found.${c.reset} Ensure agx-cloud is at ${LOCAL_AGX_CLOUD_DIR} or build standalone runtime.`);
    console.log(`${c.dim}Tip: set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud${c.reset}`);
    _boardEnsured = false;
    return;
  }

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

  let logFd;
  try {
    logFd = fs.openSync(BOARD_LOG_FILE, 'a');
  } catch (err) {
    console.error(`${c.red}Unable to open board log:${c.reset} ${err.message}`);
    _boardEnsured = false;
    return;
  }

  const boardEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    PORT: String(port),
    AGX_BOARD_DISABLE_AUTH: '1',
  };

  // Save env for downstream consumers
  saveBoardEnvValue('DATABASE_URL', dbUrl);
  saveBoardEnvValue('PORT', String(port));

  let proc;
  try {
    if (boardInfo.mode === 'bundled') {
      proc = spawn('node', ['server.js'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
      });
    } else {
      proc = spawn('npm', ['run', 'dev'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
      });
    }
  } catch (err) {
    fs.closeSync(logFd);
    console.error(`${c.red}Failed to start board server:${c.reset} ${err.message}`);
    _boardEnsured = false;
    return;
  }

  fs.closeSync(logFd);
  proc.unref();
  fs.writeFileSync(BOARD_PID_FILE, String(proc.pid));

  // Wait for server to respond
  console.log(`${c.dim}Waiting for board server (pid ${proc.pid})...${c.reset}`);
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await probeBoardHealth(port)) {
      ready = true;
      break;
    }
    await sleep(500);
  }

  if (ready) {
    console.log(`${c.green}✓${c.reset} Board server started (pid ${proc.pid}, port ${port})`);
    console.log(`${c.dim}  Logs: ${BOARD_LOG_FILE}${c.reset}`);
  } else {
    console.log(`${c.yellow}Board server started but not yet responding — check ${BOARD_LOG_FILE}${c.reset}`);
  }
}

async function stopBoard() {
  const pid = isBoardRunning();
  if (!pid) {
    console.log(`${c.yellow}Board server not running${c.reset}`);
    return false;
  }

  try {
    const stopped = await stopDaemonProcessTree(pid);
    if (fs.existsSync(BOARD_PID_FILE)) fs.unlinkSync(BOARD_PID_FILE);

    if (!stopped) {
      console.error(`${c.red}Failed to stop board server:${c.reset} pid ${pid} still running`);
      return false;
    }

    console.log(`${c.green}✓${c.reset} Board server stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop board server:${c.reset} ${err.message}`);
    return false;
  }
}

function startTemporalWorker() {
  const existingPid = isTemporalWorkerRunning();
  if (existingPid) {
    console.log(`${c.dim}Orchestrator worker already running (pid ${existingPid})${c.reset}`);
    return existingPid;
  }

  const projectDir = resolveEmbeddedWorkerProjectDir();
  if (!projectDir) {
    console.log(
      `${c.yellow}Local board runtime not found.${c.reset} ` +
      `AGX couldn't locate an agx-cloud checkout/runtime for the embedded worker.\n` +
      `${c.dim}Looked for:${c.reset} ../agx-cloud (from current directory), ${LOCAL_AGX_CLOUD_DIR}, ${PACKAGED_AGX_CLOUD_DIR}\n` +
      `${c.dim}Fix:${c.reset} set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud, then run: (cd \"$AGX_CLOUD_WORKER_DIR\" && npm install && npm run build)`
    );
    return null;
  }

  // Guardrail: packaged standalone builds frequently do not include the worker entrypoint.
  const workerEntrypoints = [
    path.join(projectDir, 'worker', 'index.ts'),
    path.join(projectDir, 'worker', 'index.js'),
    path.join(projectDir, 'worker', 'index.mjs'),
  ];
  if (!workerEntrypoints.some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  })) {
    console.log(`${c.red}Orchestrator worker entrypoint not found in:${c.reset} ${projectDir}`);
    console.log(`${c.dim}Expected one of:${c.reset} ${workerEntrypoints.join(', ')}`);
    console.log(`${c.dim}Tip:${c.reset} set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud`);
    return null;
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  let logFd;
  try {
    logFd = fs.openSync(WORKER_LOG_FILE, 'a');
  } catch (err) {
    console.error(`${c.red}Unable to open orchestrator worker log:${c.reset} ${err.message}`);
    return null;
  }

  const script = pickEmbeddedWorkerNpmScript(projectDir);
  const serverJsPath = path.join(projectDir, 'server.js');
  const isBundledRuntime = (() => {
    try { return fs.existsSync(serverJsPath); } catch { return false; }
  })();

  const pickNodeWorkerEntrypoint = () => {
    const candidates = [
      path.join(projectDir, 'worker', 'index.js'),
      path.join(projectDir, 'worker', 'index.mjs'),
      path.join(projectDir, 'worker', 'index.ts'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch { }
    }
    return null;
  };

  const pkgJsonPath = path.join(projectDir, 'package.json');
  const hasPackageJson = (() => {
    try { return fs.existsSync(pkgJsonPath); } catch { return false; }
  })();

  // In bundled board runtimes, we may not ship a full Node project with npm scripts.
  // Prefer running the worker entrypoint directly via `node`.
  const shouldRunWorkerViaNode = isBundledRuntime || !hasPackageJson;
  let worker;
  try {
    const boardEnv = loadBoardEnv();
    if (!boardEnv.DATABASE_URL) {
      console.log(`${c.yellow}Orchestrator worker not started${c.reset} (missing DATABASE_URL).`);
      console.log(`${c.dim}Start the board first so ~/.agx/board.env is populated:${c.reset} agx board start`);
      fs.closeSync(logFd);
      return null;
    }

    if (shouldRunWorkerViaNode) {
      const entry = pickNodeWorkerEntrypoint();
      if (!entry) {
        console.error(`${c.red}Unable to resolve worker entrypoint under:${c.reset} ${projectDir}`);
        fs.closeSync(logFd);
        return null;
      }
      worker = spawn('node', [entry], {
        cwd: projectDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, ...boardEnv },
      });
    } else {
      worker = spawn('npm', ['run', script], {
        cwd: projectDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, ...boardEnv },
      });
    }
  } catch (err) {
    fs.closeSync(logFd);
    console.error(`${c.red}Failed to start orchestrator worker:${c.reset} ${err.message}`);
    return null;
  }

  fs.closeSync(logFd);
  worker.unref();
  fs.writeFileSync(WORKER_PID_FILE, String(worker.pid));

  console.log(`${c.green}✓${c.reset} Orchestrator worker started (pid ${worker.pid})`);
  console.log(`${c.dim}  Logs: ${WORKER_LOG_FILE}${c.reset}`);
  return worker.pid;
}

async function ensureTemporalWorkerRunning() {
  // Ensure board.env exists (and DATABASE_URL is set) before starting the pg-boss worker.
  // Otherwise the worker may crash on startup due to missing DB credentials, and stage
  // transitions from /api/queue/complete will never be applied.
  try {
    const boardEnv = loadBoardEnv();
    if (!boardEnv.DATABASE_URL) {
      await ensureBoardRunning();
    }
  } catch { }
  return startTemporalWorker();
}

async function stopTemporalWorker() {
  const pid = isTemporalWorkerRunning();
  if (!pid) {
    console.log(`${c.yellow}Orchestrator worker not running${c.reset}`);
    return false;
  }

  try {
    const stopped = await stopDaemonProcessTree(pid);
    if (!stopped) {
      console.error(`${c.red}Failed to stop orchestrator worker process tree:${c.reset} pid ${pid} is still running`);
      return false;
    }

    if (fs.existsSync(WORKER_PID_FILE)) fs.unlinkSync(WORKER_PID_FILE);

    console.log(`${c.green}✓${c.reset} Orchestrator worker stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop orchestrator worker:${c.reset} ${err.message}`);
    return false;
  }
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

  // Run the orchestrator worker (pg-boss) so /api/queue/complete stage transitions are applied.
  void ensureTemporalWorkerRunning();

  return daemon.pid;
}

async function stopDaemon() {
  const pid = isDaemonRunning();
  let daemonStopped = false;

  if (!pid) {
    console.log(`${c.yellow}Daemon not running${c.reset}`);
  } else {
    try {
      const stopped = await stopDaemonProcessTree(pid);
      if (fs.existsSync(DAEMON_PID_FILE)) {
        fs.unlinkSync(DAEMON_PID_FILE);
      }
      if (!stopped) {
        console.error(`${c.red}Failed to stop daemon process tree:${c.reset} pid ${pid} is still running`);
      } else {
        console.log(`${c.green}✓${c.reset} Daemon stopped (pid ${pid})`);
        daemonStopped = true;
      }
    } catch (err) {
      console.error(`${c.red}Failed to stop daemon:${c.reset} ${err.message}`);
    }
  }

  const temporalStopped = await stopTemporalWorker();
  const boardStopped = await stopBoard();
  return daemonStopped || temporalStopped || boardStopped;
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

  // Version should be non-interactive and must not trigger onboarding.
  if (args.includes('--version') || args.includes('-v')) {
    try {
      const pkg = require('./package.json');
      console.log(pkg?.version || '');
    } catch {
      console.log('');
    }
    process.exit(0);
    return true;
  }

  // ============================================================
  // CLOUD STATE HELPERS
  // ============================================================

  const CLOUD_CONFIG_FILE = path.join(CONFIG_DIR, 'cloud.json');

  function isLocalApiUrl(apiUrl) {
    if (!apiUrl || typeof apiUrl !== 'string') return false;
    try {
      const u = new URL(apiUrl);
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '::1';
    } catch {
      return false;
    }
  }

  function isAuthDisabled(config) {
    if (process.env.AGX_CLOUD_AUTH_DISABLED === '1') return true;
    if (process.env.AGX_BOARD_DISABLE_AUTH === '1') return true;
    if (config?.authDisabled === true) return true;
    return isLocalApiUrl(config?.apiUrl);
  }

  function loadCloudConfig() {
    logExecutionFlow('loadCloudConfig', 'input', `path=${CLOUD_CONFIG_FILE}`);
    try {
      if (fs.existsSync(CLOUD_CONFIG_FILE)) {
        logExecutionFlow('loadCloudConfig', 'processing', 'file exists');
        const raw = fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8');
        const config = JSON.parse(raw);
        logExecutionFlow('loadCloudConfig', 'output', 'config loaded');
        return config;
      }
      logExecutionFlow('loadCloudConfig', 'output', 'file missing');
    } catch (err) {
      logExecutionFlow('loadCloudConfig', 'output', `error ${err?.message || err}`);
    }
    // Default to local board runtime when no cloud config exists.
    const apiUrl = (process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741').replace(/\/$/, '');
    const fallback = {
      apiUrl,
      token: null,
      refreshToken: null,
      userId: process.env.AGX_USER_ID || '',
      authDisabled: isLocalApiUrl(apiUrl),
    };
    logExecutionFlow('loadCloudConfig', 'output', `using default apiUrl=${fallback.apiUrl}`);
    return fallback;
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
    logExecutionFlow('cloudRequest', 'processing', `refresh token via ${refreshUrl}`);

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
        logExecutionFlow('cloudRequest', 'output', `refresh failed HTTP ${response.status}`);
        return null;
      }

      const updated = {
        ...config,
        token: data.access_token,
        refreshToken: data.refresh_token || config.refreshToken,
      };
      saveCloudConfig(updated);
      logExecutionFlow('cloudRequest', 'output', 'token refreshed');
      return updated;
    } catch (err) {
      logExecutionFlow('cloudRequest', 'output', `refresh exception ${err?.message || err}`);
      return null;
    }
  }

  async function cloudRequest(method, endpoint, body = null) {
    logExecutionFlow('cloudRequest', 'input', `method=${method}, endpoint=${endpoint}, body=${body ? JSON.stringify(body) : 'none'}`);

    // Auto-start board server on first API call (only for local URLs)
    await ensureBoardRunning();

    const config = loadCloudConfig();
    if (!config?.apiUrl) {
      const errMsg = 'Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:41741)';
      logExecutionFlow('cloudRequest', 'output', errMsg);
      throw new Error(errMsg);
    }

    const url = `${config.apiUrl}${endpoint}`;
    logExecutionFlow('cloudRequest', 'processing', `url=${url}`);
    try {
      const makeRequest = async (cfg) => {
        const options = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': cfg.userId || '',
          },
        };
        if (cfg?.token) options.headers.Authorization = `Bearer ${cfg.token}`;
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
        logExecutionFlow('cloudRequest', 'output', `error HTTP ${response.status}`);
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      logExecutionFlow('cloudRequest', 'output', `status=${response.status}`);
      return data;
    } catch (err) {
      logExecutionFlow('cloudRequest', 'output', `exception ${err?.message || err}`);
      throw err;
    }
  }

  async function resolveProjectByIdentifier(identifier) {
    if (!identifier || !identifier.trim()) {
      throw new Error('Project identifier is required');
    }
    const normalized = identifier.trim();
    try {
      const { project } = await cloudRequest('GET', `/api/projects/${encodeURIComponent(normalized)}`);
      if (project) return project;
    } catch (err) {
      const message = err?.message || '';
      if (!message.toLowerCase().includes('project not found') && !message.includes('HTTP 404')) {
        throw err;
      }
    }

    const { projects } = await cloudRequest('GET', '/api/projects');
    const matches = Array.isArray(projects) ? projects : [];
    const slugMatch = matches.find((p) => String(p?.slug || '').toLowerCase() === normalized.toLowerCase());
    if (slugMatch) return slugMatch;
    const idMatch = matches.find((p) => p?.id === normalized);
    if (idMatch) return idMatch;
    throw new Error(`Project "${identifier}" not found`);
  }

  async function resolveTaskId(taskId) {
    logExecutionFlow('resolveTaskId', 'input', `taskId=${taskId}`);
    let resolvedTaskId = taskId;
    const isNumber = /^\d+$/.test(taskId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);

    if (isNumber) {
      logExecutionFlow('resolveTaskId', 'processing', 'numeric shorthand');
      const cache = loadTaskCache();
      const index = parseInt(taskId, 10) - 1;
      const cached = cache?.tasks?.[index];
      if (!cached?.id) {
        const errMsg = `No cached task for #${taskId}. Run: agx task ls`;
        logExecutionFlow('resolveTaskId', 'output', errMsg);
        throw new Error(errMsg);
      }
      resolvedTaskId = cached.id;
      logExecutionFlow('resolveTaskId', 'output', `resolved from cache ${resolvedTaskId}`);
      return resolvedTaskId;
    }

    if (!isUuid) {
      const normalizedInput = String(taskId || '').trim().toLowerCase();
      logExecutionFlow('resolveTaskId', 'processing', `slug lookup: ${normalizedInput}`);

      // Prefer server-side exact slug resolution if available.
      try {
        const { task } = await cloudRequest('GET', `/api/tasks?slug=${encodeURIComponent(taskId)}`);
        if (task?.id) {
          resolvedTaskId = task.id;
          logExecutionFlow('resolveTaskId', 'output', `resolved slug exact ${resolvedTaskId}`);
          return resolvedTaskId;
        }
      } catch (err) {
        logExecutionFlow('resolveTaskId', 'processing', `exact slug lookup failed: ${err.message}`);
      }

      // Fallback for older/newer API variants: fetch task list and resolve locally.
      const listRes = await cloudRequest('GET', '/api/tasks');
      const tasks = Array.isArray(listRes?.tasks) ? listRes.tasks : [];
      if (!tasks.length) {
        throw new Error(`No tasks available while resolving "${taskId}"`);
      }

      const exact = tasks.find((t) => String(t?.slug || '').toLowerCase() === normalizedInput);
      if (exact?.id) {
        logExecutionFlow('resolveTaskId', 'output', `resolved slug exact(list) ${exact.id}`);
        return exact.id;
      }

      const prefixMatches = tasks.filter((t) => String(t?.slug || '').toLowerCase().startsWith(normalizedInput));
      if (prefixMatches.length === 1 && prefixMatches[0]?.id) {
        logExecutionFlow('resolveTaskId', 'output', `resolved slug prefix ${prefixMatches[0].id}`);
        return prefixMatches[0].id;
      }

      const idPrefixMatches = tasks.filter((t) => String(t?.id || '').toLowerCase().startsWith(normalizedInput));
      if (idPrefixMatches.length === 1 && idPrefixMatches[0]?.id) {
        logExecutionFlow('resolveTaskId', 'output', `resolved id prefix ${idPrefixMatches[0].id}`);
        return idPrefixMatches[0].id;
      }

      if (prefixMatches.length > 1) {
        const choices = prefixMatches.slice(0, 5).map((t) => `${t.slug || t.id}`).join(', ');
        throw new Error(`Ambiguous task "${taskId}" (matches: ${choices}). Use full slug or task ID.`);
      }

      throw new Error(`Task not found for "${taskId}". Run: agx task ls`);
    }

    logExecutionFlow('resolveTaskId', 'processing', 'uuid shortcut');
    logExecutionFlow('resolveTaskId', 'output', `using uuid ${resolvedTaskId}`);
    return resolvedTaskId;
  }

  function getOrchestrator() {
    const config = loadCloudConfig();
    if (!config?.apiUrl) {
      throw new Error('Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:41741)');
    }
    return createOrchestrator(config);
  }

  async function streamTaskLogs(taskId) {
    const config = loadCloudConfig();
    if (!config?.apiUrl) return () => { };

    const eventsourcePkg = require('eventsource');
    const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
    const esOptions = {};
    if (config?.token) {
      esOptions.headers = { Authorization: `Bearer ${config.token}` };
    }
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, esOptions);

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

  async function runTaskInline(rawTaskId, options = {}) {
    const { resetFirst = false, forceSwarm = false } = options;
    const taskId = await resolveTaskId(rawTaskId);

    if (resetFirst) {
      await cloudRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'queued',
        started_at: null,
        completed_at: null,
      });
    }

    // NOTE: `agx run` should not implicitly start the embedded orchestrator worker.
    // If you want the worker running, start it explicitly via `agx daemon start`.

    const nowIso = new Date().toISOString();
    try {
      await cloudRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'in_progress',
        started_at: nowIso,
        completed_at: null,
      });
    } catch { }

    const { task } = await cloudRequest('GET', `/api/tasks/${taskId}`);
    if (!task?.id) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const effectiveTask = forceSwarm ? { ...task, swarm: true } : task;
    console.log(`${c.green}✓${c.reset} Running task inline`);
    console.log(`${c.dim}Task: ${taskId}${c.reset}`);

	    const decisionPayload = await runCloudDaemonTask(effectiveTask);
	    // Inline run: always print the explanation so failures are actionable.
	    if (decisionPayload?.decision && decisionPayload.decision !== 'done') {
	      const detail = String(decisionPayload.summary || decisionPayload.explanation || '').trim();
	      if (detail) {
	        console.error(`${c.red}✗${c.reset} ${decisionPayload.decision}: ${detail}`);
	      } else {
	        console.error(`${c.red}✗${c.reset} ${decisionPayload.decision}`);
	      }
	    }
	    const decision = String(decisionPayload?.decision || 'failed').toLowerCase();
	    return decision === 'done' ? 0 : 1;
	  }

	  function normalizeDaemonDecision(decision, fallbackSummary = '', extra = {}) {
	    const allowed = new Set(['done', 'blocked', 'not_done', 'failed']);
	    const extractedDecision = typeof decision?.decision === 'string' ? decision.decision.trim() : '';
	    const normalizedDecision = allowed.has(extractedDecision) ? extractedDecision : 'failed';

	    const extraErr = typeof extra?.error === 'string' && extra.error.trim() ? extra.error.trim() : '';
	    const explanation = typeof decision?.explanation === 'string' && decision.explanation.trim()
	      ? decision.explanation.trim()
	      : (extraErr || fallbackSummary || `Daemon decision: ${normalizedDecision}`);
	    const finalResult = typeof decision?.final_result === 'string' && decision.final_result.trim()
	      ? decision.final_result.trim()
	      : explanation;
	    const summary = typeof decision?.summary === 'string' && decision.summary.trim()
	      ? decision.summary.trim()
	      : (extraErr || '');

	    return {
	      decision: normalizedDecision,
	      explanation,
	      final_result: finalResult,
	      summary,
	    };
	  }

	async function runCloudDaemonTask(task) {
	    const { buildCloudTaskTerminalPatch } = require('./lib/cloud/status');

	    const taskId = String(task?.id || '').trim();
	    if (!taskId) {
	      throw new Error('Queue returned task without id');
	    }

	    const provider = String(task?.provider || task?.engine || 'claude').toLowerCase();
	    const model = typeof task?.model === 'string' && task.model.trim() ? task.model.trim() : null;
	    const logger = createTaskLogger(taskId);
	    const localArtifacts = isLocalArtifactsEnabled();
	    const storage = localArtifacts ? require('./lib/storage') : null;
	    const stageLocal = mapCloudStageToLocalStage(task?.stage);
	    let projectSlug = null;
	    let taskSlug = null;
	    const orchestrator = getOrchestrator();
	    const cancellationWatcher = createCancellationWatcher({ orchestrator, taskId });

	    let lockHandle = null;
	    let lastRun = null;
	    let runIndexEntry = null;

    logger.log('system', `[daemon] picked task ${taskId} (${task?.stage || 'unknown'})\n`);
    console.log(`${c.dim}[daemon] picked ${taskId} (${task?.stage || 'unknown'}) via ${provider}${model ? `/${model}` : ''}${c.reset}`);

    let decisionPayload;
    try {
      if (localArtifacts) {
        projectSlug = await resolveLocalProjectSlugForCloudTask(storage, task);
        taskSlug = await resolveLocalTaskSlugForCloudTask(storage, projectSlug, task);

        const cloudProject = extractCloudProjectIdentity(task);
        await storage.writeProjectState(projectSlug, {
          repo_path: process.cwd(),
          cloud: {
            project_id: cloudProject.projectId,
            project_slug: cloudProject.projectSlug,
            project_name: cloudProject.projectName,
          }
        });

        const existing = await storage.readTaskState(projectSlug, taskSlug);
        if (!existing) {
          await storage.createTask(projectSlug, {
            user_request: String(task?.title || task?.user_request || task?.goal || `Cloud task ${taskId}`),
            goal: String(task?.goal || task?.title || task?.user_request || `Cloud task ${taskId}`),
            taskSlug,
          });
        }
        // Always stamp cloud references so future runs can detect collisions and reuse the same folder.
        try {
          const cloudProject2 = extractCloudProjectIdentity(task);
          const cloudTask = extractCloudTaskIdentity(task);
          await storage.updateTaskState(projectSlug, taskSlug, {
            cloud: {
              task_id: cloudTask.taskId || taskId,
              task_slug: cloudTask.taskSlug || null,
              project_id: cloudProject2.projectId,
              project_slug: cloudProject2.projectSlug,
            }
          });
        } catch { }

        // Refresh working_set.md from cloud structured fields (cloud remains authoritative).
        const workingSetMd = renderWorkingSetMarkdownFromCloudTask(task);
        if (workingSetMd) {
          const wsRes = await storage.writeWorkingSet(projectSlug, taskSlug, workingSetMd);
          // Event emission is per-run; buffer until run exists.
          if (wsRes?.event) {
            // Create run first so we can attach the event.
            // (If run creation fails, we'll still have the working_set.md updated.)
          }
        }

        // Acquire local lock so concurrent daemons don't stomp local artifacts.
        lockHandle = await storage.acquireTaskLock(storage.taskRoot(projectSlug, taskSlug));

        // Recovery: close incomplete runs and create resume runs (if any).
        const incomplete = await storage.findIncompleteRuns(projectSlug, taskSlug);
        if (incomplete.length > 0) {
          for (const inc of incomplete) {
            await storage.createRecoveryRun(projectSlug, taskSlug, inc);
          }
        }

        // Fetch task comments for full context recording.
        let taskCommentsForArtifact = [];
        try {
          const commentsResponse = await cloudRequest('GET', `/api/tasks/${taskId}/comments`);
          taskCommentsForArtifact = commentsResponse?.comments || [];
        } catch {
          // Comments unavailable, continue without them
        }

        // Record the full initial prompt context (not just JSON metadata)
        const fullPromptContext = buildFullDaemonPromptContext(task, {
          comments: taskCommentsForArtifact,
          provider,
          model,
        });

        // Mark local task as running once before iterating.
        await storage.updateTaskState(projectSlug, taskSlug, { status: 'running' });

        // Execute+verify loop runs per-iteration local runs under the mapped cloud stage.
        let loopResult;
	        if (task?.swarm) {
	          loopResult = await runSwarmExecuteVerifyLoop({
	            taskId,
	            task,
	            logger,
	            storage,
	            projectSlug,
	            taskSlug,
	            stageLocal,
	            initialPromptContext: fullPromptContext,
	            cancellationWatcher,
	          });
	        } else {
          loopResult = await runSingleAgentExecuteVerifyLoop({
            taskId,
            task,
            provider,
            model,
            logger,
            storage,
            projectSlug,
            taskSlug,
            stageLocal,
            initialPromptContext: fullPromptContext,
            cancellationWatcher,
          });
        }

        lastRun = loopResult?.lastRun || null;
        runIndexEntry = loopResult?.runIndexEntry || null;
	          decisionPayload = normalizeDaemonDecision(
	            loopResult?.decision,
	            loopResult?.code === 0 ? 'Execution completed.' : 'Execution failed.',
	            { error: task?.error || '' }
	          );
      } else {
        // Fallback: cloud-only execution path (legacy).
        if (task?.swarm) {
	          runResult = await runSwarmLoop({ taskId, task, artifacts: null, cancellationWatcher });
	          decisionPayload = normalizeDaemonDecision(
	            runResult?.decision,
	            runResult?.code === 0 ? 'Swarm execution completed.' : 'Swarm execution failed.',
	            { error: task?.error || '' }
	          );
        } else {
          runResult = await runSingleAgentLoop({
            taskId,
            task,
            provider,
            model,
            logger,
            artifacts: null,
            cancellationWatcher,
          });
	          decisionPayload = normalizeDaemonDecision(
	            runResult?.decision,
	            runResult?.code === 0 ? 'Single-agent execution completed.' : 'Single-agent execution failed.',
	            { error: task?.error || '' }
	          );
        }
      }
	    } catch (err) {
	      const message = err?.message || 'Daemon execution failed.';
	      // This error is in the daemon process (not the spawned agx subprocess), so also write it
	      // to the run container when local artifacts are enabled.
	      if (localArtifacts && lastRun?.paths?.root) {
	        const runContainerPath = path.dirname(lastRun.paths.root);
	        const detail = err?.stack || message;
	        await appendRunContainerLog(runContainerPath, 'daemon/daemon_error.log', `[${new Date().toISOString()}] ${detail}`);
	      }
	      decisionPayload = {
	        decision: 'failed',
	        explanation: message,
	        final_result: message,
	        summary: message,
	      };
	      logger.log('error', `[daemon] execution failed: ${message}\n`);
	    } finally {
	      await logger.flushAll();
	      try { cancellationWatcher?.destroy?.(); } catch { }
	      if (localArtifacts) {
	        try {
	          // Runs are finalized per-iteration inside the execute/verify loop.
	        } catch (e) {
          // Never break cloud completion because local artifacts failed.
          logger?.log('error', `[daemon] local artifact finalize failed: ${e?.message || e}\n`);
        } finally {
          if (lockHandle && storage) {
            try { await storage.releaseTaskLock(lockHandle); } catch { }
          }
        }
      }
    }

	    const completionResult = await cloudRequest('POST', '/api/queue/complete', {
	      taskId,
	      log: decisionPayload.summary || decisionPayload.explanation,
	      decision: decisionPayload.decision,
	      final_result: decisionPayload.final_result,
      explanation: decisionPayload.explanation,
      ...(localArtifacts && lastRun?.paths?.root ? {
        artifact_path: lastRun.paths.root,
        artifact_host: os.hostname(),
        artifact_key: localArtifactKey(lastRun.paths.root),
      } : {}),
	      ...(runIndexEntry ? { run_entry: runIndexEntry } : {}),
	    });

	    // Best-effort: ensure cloud task status is terminal when stage/decision indicates completion.
	    // Some board runtimes advance `stage` to "done" but leave `status` as "in_progress".
	    try {
	      let newStage = completionResult?.newStage || completionResult?.task?.stage || null;
	      if (!newStage) {
	        try {
	          const { task: refreshed } = await cloudRequest('GET', `/api/tasks/${taskId}`);
	          newStage = refreshed?.stage || null;
	        } catch { }
	      }
	      const patch = buildCloudTaskTerminalPatch({ decision: decisionPayload?.decision, newStage });
	      if (patch) {
	        await cloudRequest('PATCH', `/api/tasks/${taskId}`, patch);
	      }
	    } catch { }

	    // Post a structured outcome comment (separate from queue completion log).
	    await postTaskComment(taskId, [
	      `## ${task?.stage || 'stage'} completed`,
	      '',
      `Decision: ${decisionPayload.decision}`,
      '',
      decisionPayload.summary || decisionPayload.explanation || '',
      localArtifacts && lastRun ? '' : '',
      localArtifacts && lastRun ? `(Local run id: ${lastRun.run_id}, stage: ${lastRun.stage})` : '',
    ].filter(Boolean).join('\n'));

    {
      const detailRaw = String(decisionPayload.summary || decisionPayload.explanation || '').trim();
      const detail = detailRaw ? detailRaw.replace(/\s+/g, ' ').slice(0, 320) : '';
      const suffix = detail ? ` | ${detail}${detailRaw.length > 320 ? '…' : ''}` : '';
      console.log(`${c.dim}[daemon] completed ${taskId} → ${decisionPayload.decision}${suffix}${c.reset}`);
      if (localArtifacts && lastRun?.paths?.root) {
        console.log(`${c.dim}[daemon] local artifacts: ${lastRun.paths.root}${c.reset}`);
      }
    }
    return decisionPayload;
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
  // LOCAL-FIRST CLI COMMANDS
  // These commands use ~/.agx/projects/ filesystem storage.
  // Use --local flag or AGX_LOCAL=1 to force local mode.
  // ============================================================

  const isLocalMode = args.includes('--local') || process.env.AGX_LOCAL === '1';

  // agx local:new "<goal>" [--local]
  // Creates a new task in local storage
  if (cmd === 'local:new' || (cmd === 'new' && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');

    // Extract goal text
    const flagsToRemove = ['--json', '--local', '--provider', '-P', '--model', '-m'];
    const goalParts = [];
    for (let i = 1; i < args.length; i++) {
      if (flagsToRemove.includes(args[i])) {
        if (['--provider', '-P', '--model', '-m'].includes(args[i])) i++;
        continue;
      }
      goalParts.push(args[i]);
    }
    const goalText = goalParts.join(' ');

    if (!goalText) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'missing_goal', usage: 'agx new "<goal>" --local' }));
      } else {
        console.log(`${c.red}Usage:${c.reset} agx new "<goal>" --local`);
      }
      process.exit(1);
    }

    try {
      await localCli.cmdNew({ userRequest: goalText, json: jsonMode });
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

  // agx local:tasks [--all] [--local]
  // List tasks from local storage
  if (cmd === 'local:tasks' || cmd === 'local:ls' || ((cmd === 'tasks' || cmd === 'ls') && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const showAll = args.includes('-a') || args.includes('--all');

    try {
      await localCli.cmdTasks({ all: showAll, json: jsonMode });
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

  // agx local:show <task> [--local]
  // Show task details from local storage
  if (cmd === 'local:show' || (cmd === 'show' && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx show <task> --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdShow({ taskSlug, json: jsonMode });
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

  // agx local:runs <task> [--stage <stage>] [--local]
  // List runs for a task from local storage
  if (cmd === 'local:runs' || (cmd === 'runs' && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    let stage = null;
    const stageIdx = args.findIndex(a => a === '--stage' || a === '-s');
    if (stageIdx !== -1 && args[stageIdx + 1]) {
      stage = args[stageIdx + 1];
    }

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx runs <task> [--stage <stage>] --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdRuns({ taskSlug, stage, json: jsonMode });
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

  // agx local:complete <task> [--local]
  // Mark a task complete in local storage
  if (cmd === 'local:complete' || ((cmd === 'complete' || cmd === 'done') && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx complete <task> --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdComplete({ taskSlug, json: jsonMode });
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

  // agx gc [--task <task>] [--keep <n>]
  // Run garbage collection on runs
  if (cmd === 'gc') {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');

    let taskSlug = null;
    const taskIdx = args.findIndex(a => a === '--task' || a === '-t');
    if (taskIdx !== -1 && args[taskIdx + 1]) {
      taskSlug = args[taskIdx + 1];
    }

    let keep = 25;
    const keepIdx = args.findIndex(a => a === '--keep' || a === '-k');
    if (keepIdx !== -1 && args[keepIdx + 1]) {
      keep = parseInt(args[keepIdx + 1], 10) || 25;
    }

    try {
      await localCli.cmdGc({ taskSlug, keep, json: jsonMode });
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

  // agx local:run <task> [--stage <stage>] [--local]
  // Prepare a run in local storage
  if (cmd === 'local:run' || (cmd === 'run' && isLocalMode)) {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    let stage = 'execute';
    const stageIdx = args.findIndex(a => a === '--stage' || a === '-s');
    if (stageIdx !== -1 && args[stageIdx + 1]) {
      stage = args[stageIdx + 1];
    }

    let engine = 'claude';
    const engineIdx = args.findIndex(a => a === '--engine' || a === '-e');
    if (engineIdx !== -1 && args[engineIdx + 1]) {
      engine = args[engineIdx + 1];
    }

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx run <task> [--stage <stage>] --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdRun({ taskSlug, stage, engine, json: jsonMode });
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

  // agx unlock <task> [--local]
  // Force unlock a task
  if (cmd === 'unlock' || cmd === 'local:unlock') {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx unlock <task>`);
      process.exit(1);
    }

    try {
      await localCli.cmdUnlock({ taskSlug, json: jsonMode });
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

  // agx tail <task> [--local]
  // Stream events for a task's latest run
  if (cmd === 'tail' || cmd === 'local:tail') {
    const localCli = require('./lib/local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx tail <task>`);
      process.exit(1);
    }

    try {
      await localCli.cmdTail({ taskSlug, json: jsonMode });
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
        if (task.slug) {
          console.log(`${c.dim}Slug: ${task.slug}${c.reset}`);
        }
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
      if (!cloudConfig?.apiUrl) {
        console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
        process.exit(1);
      }

      // Ensure the pg-boss orchestrator worker is running; otherwise stage completion signals
      // won't be processed and tasks can get stuck in in_progress.
      await ensureTemporalWorkerRunning();

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

  // ==================== BOARD COMMAND ====================
  if (cmd === 'board') {
    const subcmd = args[1];
    if (!subcmd || subcmd === 'start') {
      _boardEnsured = false; // force re-check
      await ensureBoardRunning();
      // `agx run` intentionally does not autostart the orchestrator worker, but
      // `agx board start` is an explicit local-runtime action, so we also start
      // the worker to ensure /api/queue/complete stage transitions are applied.
      void ensureTemporalWorkerRunning();
      process.exit(0);
    } else if (subcmd === 'stop') {
      await stopBoard();
      // Best-effort: stop the worker when stopping the local board runtime.
      await stopTemporalWorker();
      process.exit(0);
    } else if (subcmd === 'status') {
      const pid = isBoardRunning();
      if (pid) {
        const port = getBoardPort();
        const healthy = await probeBoardHealth(port);
        console.log(`${c.green}Board server running${c.reset} (pid ${pid}, port ${port}${healthy ? ', healthy' : ', not responding'})`);
        console.log(`${c.dim}Logs: ${BOARD_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Board server not running${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'logs') {
      if (fs.existsSync(BOARD_LOG_FILE)) {
        const logs = fs.readFileSync(BOARD_LOG_FILE, 'utf8');
        console.log(logs.split('\n').slice(-50).join('\n'));
      } else {
        console.log(`${c.dim}No board logs yet${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'tail') {
      if (!fs.existsSync(BOARD_LOG_FILE)) {
        console.log(`${c.dim}No board logs yet. Start with: agx board start${c.reset}`);
        process.exit(0);
      }
      console.log(`${c.dim}Tailing ${BOARD_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
      const tail = spawn('tail', ['-f', BOARD_LOG_FILE], { stdio: 'inherit' });
      tail.on('close', () => process.exit(0));
      return true;
    } else {
      console.log(`${c.red}Unknown board command:${c.reset} ${subcmd}`);
      console.log(`${c.dim}Usage: agx board [start|stop|status|logs|tail]${c.reset}`);
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

  // agx logout
  if (cmd === 'logout') {
    if (fs.existsSync(CLOUD_CONFIG_FILE)) {
      fs.unlinkSync(CLOUD_CONFIG_FILE);
    }
    console.log(`${c.green}✓${c.reset} Cleared cloud configuration`);
    process.exit(0);
  }

  // agx status
  if (cmd === 'status') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.yellow}Not connected to cloud${c.reset}`);
      console.log(`${c.dim}Configure ${path.join(CONFIG_DIR, 'cloud.json')} or set AGX_CLOUD_URL${c.reset}`);
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

  // agx project ... - manage structured metadata
  function formatProjectMetadataEntries(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
    return Object.entries(metadata);
  }

  function printProjectSummary(project) {
    if (!project) return;
    const slugSuffix = project.slug ? ` (${project.slug})` : '';
    console.log(`${c.bold}${project.name || '(unnamed project)'}${c.reset}${slugSuffix}`);
    console.log(`  ID: ${project.id}`);
    if (project.description) {
      console.log(`  Description: ${project.description}`);
    }
  }

  function printProjectDetails(project) {
    if (!project) return;
    printProjectSummary(project);
    if (project.ci_cd_info) {
      console.log(`  CI/CD: ${project.ci_cd_info}`);
    }
    if (project.workflow_id) {
      console.log(`  Workflow: ${project.workflow_id}`);
    }
    const metadataEntries = formatProjectMetadataEntries(project.metadata);
    if (metadataEntries.length) {
      console.log('  Metadata:');
      metadataEntries.forEach(([key, value]) => {
        console.log(`    ${key}: ${value}`);
      });
    }
    if (Array.isArray(project.repos) && project.repos.length) {
      console.log('  Repos:');
      project.repos.forEach((repo) => {
        const parts = [repo.name];
        if (repo.path) parts.push(`path: ${repo.path}`);
        if (repo.git_url) parts.push(`git_url: ${repo.git_url}`);
        if (repo.notes) parts.push(`notes: ${repo.notes}`);
        console.log(`    - ${parts.join(' | ')}`);
      });
    }
  }

  function printProjectHelp() {
    console.log(`${c.bold}agx project${c.reset} - Manage structured project metadata`);
    console.log('');
    console.log('Usage:');
    console.log('  agx project list');
    console.log('  agx project get <id|slug>');
    console.log('  agx project create --name <name> [--slug <slug>] [--description <text>] [--ci <info>] [--workflow <id>]');
    console.log('                    [--metadata key=value] [--repo \'{"name":"repo","path":"/code"}\']');
    console.log('  agx project update <id|slug> [--name <name>] [--slug <slug>] [--description <text>]');
    console.log('                    [--ci <info>] [--workflow <id>] [--metadata key=value] [--repo <json>]');
    console.log('  agx project assign <id|slug> --task <task>');
    console.log('  agx project unassign --task <task>');
    console.log('');
    console.log('Flags:');
    console.log('  --name <name>               Project name (required for create)');
    console.log('  --slug <slug>               Optional canonical slug');
    console.log('  --description <text>        Human-friendly description');
    console.log('  --ci, --ci-info <info>      CI/CD notes');
    console.log('  --workflow, --workflow-id <id>  Workflow reference');
    console.log('  --metadata key=value        Attach metadata entries (repeatable)');
    console.log('  --repo <json>               Describe repo info (repeatable; JSON)');
    console.log('  --task, -t                  Task identifier for assign/unassign');
  }

  function getTaskFlagValue(argv) {
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--task' || argv[i] === '-t') {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) return next;
      }
    }
    return null;
  }

  if (cmd === 'project') {
    const projectArgs = args.slice(1);
    const wantsHelp = projectArgs.includes('--help') || projectArgs.includes('-h');
    if (!projectArgs.length || wantsHelp) {
      printProjectHelp();
      process.exit(wantsHelp ? 0 : 1);
    }

    const cloudConfig = loadCloudConfigFile();
    if (!cloudConfig?.apiUrl) {
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
      process.exit(1);
    }

    const subcmd = projectArgs[0];
    const subArgs = projectArgs.slice(1);

    try {
      switch (subcmd) {
        case 'list': {
          const { projects } = await cloudRequest('GET', '/api/projects');
          const items = Array.isArray(projects) ? projects : [];
          if (items.length === 0) {
            console.log(`${c.dim}No projects found${c.reset}`);
          } else {
            console.log(`${c.bold}Projects (${items.length})${c.reset}`);
            items.forEach((project, index) => {
              printProjectSummary(project);
              if (index < items.length - 1) console.log('');
            });
          }
          process.exit(0);
          break;
        }
        case 'get': {
          const identifier = subArgs[0];
          if (!identifier) {
            console.log(`${c.yellow}Usage:${c.reset} agx project get <id|slug>`);
            process.exit(1);
          }
          const project = await resolveProjectByIdentifier(identifier);
          printProjectDetails(project);
          process.exit(0);
          break;
        }
        case 'create': {
          const flags = collectProjectFlags(subArgs);
          const { project } = await createProject(flags, cloudRequest);
          console.log(`${c.green}✓${c.reset} Project created: ${project.name} (${project.slug || project.id})`);
          printProjectDetails(project);
          process.exit(0);
          break;
        }
        case 'update': {
          const identifier = subArgs[0];
          if (!identifier) {
            console.log(`${c.yellow}Usage:${c.reset} agx project update <id|slug> [flags]`);
            process.exit(1);
          }
          const flags = collectProjectFlags(subArgs.slice(1));
          const body = buildProjectBody(flags);
          if (!Object.keys(body).length) {
            throw new Error('At least one field must be specified to update a project.');
          }
          const targetProject = await resolveProjectByIdentifier(identifier);
          const { project } = await cloudRequest('PATCH', `/api/projects/${targetProject.id}`, body);
          console.log(`${c.green}✓${c.reset} Project updated: ${project.name} (${project.slug || project.id})`);
          printProjectDetails(project);
          process.exit(0);
          break;
        }
        case 'assign': {
          const projectIdentifier = subArgs[0];
          if (!projectIdentifier) {
            console.log(`${c.yellow}Usage:${c.reset} agx project assign <id|slug> --task <task>`);
            process.exit(1);
          }
          const taskIdentifier = getTaskFlagValue(subArgs);
          if (!taskIdentifier) {
            console.log(`${c.yellow}Usage:${c.reset} agx project assign <id|slug> --task <task>`);
            process.exit(1);
          }
          const project = await resolveProjectByIdentifier(projectIdentifier);
          const resolvedTaskId = await resolveTaskId(taskIdentifier);
          await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, {
            project: project.slug || project.id,
            project_id: project.id,
          });
          console.log(`${c.green}✓${c.reset} Task ${resolvedTaskId} assigned to project ${project.slug || project.id}`);
          process.exit(0);
          break;
        }
        case 'unassign': {
          const taskIdentifier = getTaskFlagValue(subArgs);
          if (!taskIdentifier) {
            console.log(`${c.yellow}Usage:${c.reset} agx project unassign --task <task>`);
            process.exit(1);
          }
          const resolvedTaskId = await resolveTaskId(taskIdentifier);
          await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, {
            project: null,
            project_id: null,
          });
          console.log(`${c.green}✓${c.reset} Task ${resolvedTaskId} removed from its project`);
          process.exit(0);
          break;
        }
        default:
          console.log(`${c.yellow}Unknown project command:${c.reset} ${subcmd}`);
          printProjectHelp();
          process.exit(1);
      }
    } catch (err) {
      console.log(`${c.red}✗${c.reset} ${err.message}`);
      process.exit(1);
    }
  }

  // agx workflow ... - manage workflows
  if (cmd === 'workflow') {
    const { handleWorkflowCommand } = require('./lib/workflow-cli');
    const workflowArgs = args.slice(1);
    try {
      await handleWorkflowCommand(workflowArgs, cloudRequest);
      process.exit(0);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} ${err.message}`);
      process.exit(1);
    }
  }

  // agx new "<task description>" [--project <name>] [--priority <n>] [--engine <name>]
  if (cmd === 'new' || cmd === 'push') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
      process.exit(1);
    }

    // Parse flags
    let projectSlug = null, projectId = null, priority = null, engine = null, provider = null, model = null, ticketType = null;
    const taskParts = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--project' || args[i] === '-p') {
        projectSlug = args[++i];
      } else if (args[i] === '--project-slug') {
        projectSlug = args[++i];
      } else if (args[i] === '--project-id') {
        projectId = args[++i];
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
      console.log(`${c.yellow}Usage:${c.reset} agx new "<task>" [--project <slug>] [--project-slug <slug>] [--project-id <uuid>] [--priority n] [--engine claude|gemini|ollama|codex] [--type spike|task]`);
      process.exit(1);
    }

    // Build markdown content
    const frontmatter = ['status: queued', 'stage: ideation'];
    if (projectSlug) frontmatter.push(`project: ${projectSlug}`);
    if (projectId) frontmatter.push(`project_id: ${projectId}`);
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
      if (task.slug) {
        console.log(`  Slug: ${task.slug}`);
      }
      console.log(`  Stage: ${task.stage || 'ideation'}`);
      if (projectSlug) console.log(`  Project: ${projectSlug}`);
      if (projectId) console.log(`  Project ID: ${projectId}`);
      console.log(`${c.dim}Use: agx run ${task.slug || task.id}${c.reset}`);
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
      const exitCode = await runTaskInline(taskId, { forceSwarm });
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
    logExecutionFlow('retry command', 'input', `cmd=${cmd}, args=${runArgs.slice(1).join(' ')}`);
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
      logExecutionFlow('retry command', 'output', 'missing task id');
      console.log(`${c.yellow}Usage:${c.reset} agx retry <taskId> [--task <id>] [--swarm]`);
      console.log(`${c.dim}   or:${c.reset} agx task retry <taskId> [--task <id>] [--swarm]`);
      process.exit(1);
    }

    try {
      const exitCode = await runTaskInline(taskId, { resetFirst: true, forceSwarm });
      process.exit(exitCode);
    } catch (err) {
      logExecutionFlow('retry command', 'output', `failed ${err.message}`);
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }
  }

  // agx task ls [-a]  (Docker-style namespace)
  if ((cmd === 'task' && args[1] === 'ls') || cmd === 'list' || cmd === 'ls' || cmd === 'tasks') {
    const showAll = args.includes('-a') || args.includes('--all');
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
	          blocked: c.yellow + '!' + c.reset,
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
	      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
		      const { buildCloudTaskTerminalPatch } = require('./lib/cloud/status');

		      const resolvedTaskId = await resolveTaskId(taskId);
		      const { task: existingTask } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}`);
		      const existingStage = String(existingTask?.stage || '').toLowerCase();

		      // If the task is already in the terminal stage, don't call /queue/complete again.
		      // Just align status to terminal (this fixes stage=status drift safely).
		      if (existingStage === 'done') {
		        const patch = buildCloudTaskTerminalPatch({ newStage: 'done' });
		        if (patch) {
		          await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, patch);
		        }
		        console.log(`${c.green}✓${c.reset} Task already in done stage; status aligned`);
		        process.exit(0);
		      }

			      const message = log || 'Stage completed via agx CLI';
			      const { task, newStage } = await cloudRequest('POST', '/api/queue/complete', {
			        taskId: resolvedTaskId,
			        log: message,
			        decision: 'done',
			        explanation: message,
			        final_result: message,
			      });
			      let stageAfter = newStage || task?.stage || null;
			      if (!stageAfter) {
			        try {
			          const { task: refreshed } = await cloudRequest('GET', `/api/tasks/${resolvedTaskId}`);
			          stageAfter = refreshed?.stage || null;
			        } catch { }
			      }

			      // If this completion transitioned the task into a terminal stage, align `status` too.
			      try {
			        const patch = buildCloudTaskTerminalPatch({ newStage: stageAfter });
			        if (patch) {
			          await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, patch);
			        }
			      } catch { }

			      console.log(`${c.green}✓${c.reset} Stage completed`);
			      console.log(`  New stage: ${stageAfter || 'unknown'}`);
			      if (String(stageAfter || '').toLowerCase() === 'done') {
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
      process.exit(1);
    }

    console.log(`${c.cyan}→${c.reset} Watching for task updates... (Ctrl+C to stop)\n`);

    // Use EventSource for SSE
    const eventsourcePkg = require('eventsource');
    const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
    const esOptions = {};
    if (config?.token) {
      esOptions.headers = { Authorization: `Bearer ${config.token}` };
    }
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, esOptions);

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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
    const esOptions = {};
    if (config?.token) {
      esOptions.headers = { Authorization: `Bearer ${config.token}` };
    }
    const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, esOptions);

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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
        const esOptions = {};
        if (config?.token) {
          esOptions.headers = { Authorization: `Bearer ${config.token}` };
        }
        const es = new EventSource(`${config.apiUrl}/api/tasks/stream`, esOptions);

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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
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
        console.log(`    ${c.dim}Run: agx security rotate${c.reset}`);
      }

      console.log(`\n  Config: ${SECURITY_CONFIG_FILE}`);
      process.exit(0);
    }

    if (securityCmd === 'rotate') {
      const config = loadCloudConfig();
      const confirm = await prompt(`${c.yellow}Rotate daemon secret?${c.reset} This will invalidate all pending signed tasks. (y/N): `);
      if (confirm?.toLowerCase() !== 'y' && confirm?.toLowerCase() !== 'yes') {
        console.log(`${c.dim}Cancelled${c.reset}`);
        process.exit(0);
      }

      const { secret, isNew } = await setupDaemonSecret({
        force: true,
        cloudApiUrl: config.apiUrl,
        cloudToken: config?.token || null,
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

  // First run detection — skip for non-interactive/daemon contexts
  const config = loadConfig();
  const isNonInteractive = args.includes('--print') || args.includes('--cloud-task') || args.some(a => a.startsWith('--cloud-task'));
  if (!config && args.length === 0 && !args.includes('--help') && !args.includes('-h') && !isNonInteractive) {
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
  agx new "<task>"       Create task in cloud
  agx run <id|slug|#>    Claim and run a task
  agx retry <id|slug|#>  Reset + retry a task
  agx status             Show cloud status
  agx complete <taskId>  Mark task stage complete
  agx project assign <project> --task <task>   Assign task to project
  agx project unassign --task <task>           Remove project assignment from task

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

    // Codex approval/sandbox modes:
    // - Officially documented: --auto-edit, --full-auto
    // - Some Codex builds also accept: --dangerously-bypass-approvals-and-sandbox
    // We only attempt the dangerous bypass for unattended runs, and we add a runtime
    // retry below if the installed Codex CLI rejects the flag.
    // If we're using `codex exec`, choose exactly one execution policy:
    // - default unattended: --full-auto (sandboxed, workspace-write)
    // - explicit yolo: --dangerously-bypass-approvals-and-sandbox (unsandboxed)
    //
    // Codex CLI rejects using both at once.
    if (shouldUseExec) {
      if (options.yolo) {
        translatedArgs.push('--dangerously-bypass-approvals-and-sandbox');
      } else {
        translatedArgs.push('--full-auto');
      }
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

  function isLocalApiUrl(apiUrl) {
    if (!apiUrl || typeof apiUrl !== 'string') return false;
    try {
      const u = new URL(apiUrl);
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '::1';
    } catch {
      return false;
    }
  }

  function isAuthDisabled(config) {
    if (process.env.AGX_CLOUD_AUTH_DISABLED === '1') return true;
    if (process.env.AGX_BOARD_DISABLE_AUTH === '1') return true;
    if (config?.authDisabled === true) return true;
    return isLocalApiUrl(config?.apiUrl);
  }

  function loadCloudConfig() {
    try {
      if (fs.existsSync(CLOUD_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
      }
    } catch { }
    // Default to local board runtime when no cloud config exists.
    // Daemon should work without any auth flow; cloud may be unauthenticated.
    const apiUrl = (process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741').replace(/\/$/, '');
    return {
      apiUrl,
      token: null,
      refreshToken: null,
      userId: process.env.AGX_USER_ID || '',
      authDisabled: isLocalApiUrl(apiUrl),
    };
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
    if (!config?.apiUrl) {
      throw new Error('Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:41741)');
    }

    const url = `${config.apiUrl}${endpoint}`;
    const makeRequest = async (cfg) => {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': cfg.userId || '',
        },
      };
      if (cfg?.token) {
        fetchOptions.headers.Authorization = `Bearer ${cfg.token}`;
      }
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

      // Fetch task comments
      let taskComments = [];
      try {
        const commentsResponse = await cloudRequest('GET', `/api/tasks/${options.cloudTaskId}/comments`);
        taskComments = commentsResponse?.comments || [];
      } catch (err) {
        console.error(`${c.yellow}Warning: Could not fetch task comments:${c.reset} ${err.message}`);
      }

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

User Request: 
"""
${task?.title}
${task?.content}
---
Task Thread:
${taskComments.map(c => `${c.author}: ${c.content}`).join('\n')}
"""

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
      if (cloudConfig?.apiUrl) {
        const frontmatter = ['status: queued', 'stage: ideation'];
        frontmatter.push(`engine: ${provider}`);

        const content = `---\n${frontmatter.join('\n')}\n---\n\n# ${finalPrompt}\n`;

        const { task } = await cloudRequest('POST', '/api/tasks', { content });

        console.log(`${c.green}✓${c.reset} Task created in cloud: ${task.id}`);
        options.cloudTaskId = task.id;

        // Fetch task comments (should be empty for new tasks, but good practice)
        let taskComments = [];
        try {
          const commentsResponse = await cloudRequest('GET', `/api/tasks/${task.id}/comments`);
          taskComments = commentsResponse?.comments || [];
        } catch (err) {
          console.error(`${c.yellow}Warning: Could not fetch task comments:${c.reset} ${err.message}`);
        }

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

User Request: 
"""
${task?.title}
${task?.content}
---
Task Thread:
${taskComments.map(c => `${c.author}: ${c.content}`).join('\n')}
"""

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
        console.log(`${c.yellow}Cloud API URL not configured. Set AGX_CLOUD_URL (default http://localhost:41741).${c.reset}`);
        console.log(`${c.dim}Task not created. Running in one-shot mode.${c.reset}`);
      }
    } catch (err) {
      console.error(`${c.yellow}Warning: Could not create cloud task:${c.reset} ${err.message}`);
      console.log(`${c.dim}Running in one-shot mode.${c.reset}`);
    }
  }

  // Normal mode - just pass through to provider
  const useOllamaPipe = provider === 'ollama' && options.ollamaPrompt && command === 'ollama';
  const shouldRetryCodexBypassFlag = command === 'codex'
    && translatedArgs.includes('--dangerously-bypass-approvals-and-sandbox');

  const spawnProvider = (cmd, args, spawnOpts) => {
    const childProc = spawn(cmd, args, spawnOpts);
    // Send prompt to Ollama via stdin
    if (useOllamaPipe && childProc.stdin) {
      childProc.stdin.write(options.ollamaPrompt);
      childProc.stdin.end();
    }

    childProc.on('exit', (code) => {
      process.exit(code || 0);
    });

    childProc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error(`${c.red}Error:${c.reset} "${cmd}" command not found.`);
        console.error(`\n${c.dim}Install it first:${c.reset}`);
        if (cmd === 'claude') {
          console.error(`  npm install -g @anthropic-ai/claude-code`);
        } else if (cmd === 'gemini') {
          console.error(`  npm install -g @google/gemini-cli`);
        } else if (cmd === 'ollama') {
          console.error(`  brew install ollama  # macOS`);
          console.error(`  curl -fsSL https://ollama.ai/install.sh | sh  # Linux`);
        } else if (cmd === 'codex') {
          console.error(`  npm install -g @openai/codex`);
        }
      } else {
        console.error(`${c.red}Failed to start ${cmd}:${c.reset}`, err.message);
      }
      process.exit(1);
    });

    return childProc;
  };

  if (!shouldRetryCodexBypassFlag) {
    spawnProvider(command, translatedArgs, {
      env,
      stdio: useOllamaPipe ? ['pipe', 'inherit', 'inherit'] : 'inherit',
      shell: false
    });
  } else {
    // Best-effort compatibility: if the local Codex CLI doesn't recognize
    // --dangerously-bypass-approvals-and-sandbox, retry without it.
    const firstArgs = translatedArgs.slice();
    const retryArgs = translatedArgs.filter((a) => a !== '--dangerously-bypass-approvals-and-sandbox');

    let stderrBuf = '';
    const maxBuf = 16 * 1024;

    const child = spawn(command, firstArgs, {
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false
    });

    if (child.stdout) {
      child.stdout.on('data', (d) => process.stdout.write(d));
    }
    if (child.stderr) {
      child.stderr.on('data', (d) => {
        process.stderr.write(d);
        if (stderrBuf.length < maxBuf) {
          stderrBuf += d.toString('utf8').slice(0, maxBuf - stderrBuf.length);
        }
      });
    }

    child.on('close', (code) => {
      const failed = (code || 0) !== 0;
      const looksLikeUnknownFlag = /unknown option|unknown flag|unrecognized option|unexpected argument|invalid option/i.test(stderrBuf)
        && /dangerously-bypass-approvals-and-sandbox/i.test(stderrBuf);
      if (failed && looksLikeUnknownFlag) {
        console.error(`${c.yellow}[agx] Codex CLI rejected --dangerously-bypass-approvals-and-sandbox; retrying without it.${c.reset}`);
        spawnProvider(command, retryArgs, {
          env,
          stdio: 'inherit',
          shell: false
        });
        return;
      }
      process.exit(code || 0);
    });

    child.on('error', (err) => {
      console.error(`${c.red}Failed to start ${command}:${c.reset}`, err.message);
      process.exit(1);
    });
  }

})();

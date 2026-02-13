/* eslint-disable no-console */
'use strict';

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

const execa = require('execa');
const pMap = require('p-map');
const pRetry = require("p-retry");
const pRetryFn = pRetry.default || pRetry;
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { c } = require('../ui/colors');
const { AGX_SKILL } = require('./skillText');
const { sanitizeCliArg, sanitizeCliArgs } = require('./sanitize');
const { loadCloudConfigFile, saveCloudConfigFile, clearCloudConfig } = require('../config/cloudConfig');
const { truncateForComment, cleanAgentOutputForComment, extractFileRefsFromText } = require('../ui/text');
const { commandExists } = require('../proc/commandExists');
const { spawnCloudTaskProcess } = require('../proc/spawnCloudTaskProcess');
const { scheduleTermination } = require('../proc/killProcessTree');
const { getProcessManager } = require('../proc/ProcessManager');
const { createCloudClient } = require('../cloud/client');
const { showCloudTaskStatus } = require('./taskStatusService');
const {
  buildContinueCloudTaskPrompt,
  buildNewAutonomousCloudTaskPrompt,
  buildCloudTaskPromptFromContext,
} = require('../prompts/cloudTask');
const {
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement
} = require('../stage-requirements');
const { detectVerifyCommands, runVerifyCommands, getGitSummary } = require('../verifier');
const { createOrchestrator } = require('../orchestrator');
const {
  CANCELLED_ERROR_CODE,
  CancellationRequestedError,
  createCancellationWatcher,
  extractCancellationReason,
  isCancellationPayload,
} = require('../workerCancellation');
const {
  collectProjectFlags,
  buildProjectBody,
  createProject,
} = require('../project-cli');

const { loadConfig, saveConfig, prompt } = require('./configStore');
const providersCli = require('./providers');
const { handleSkillCommand } = require('./skills');
const { runOnboarding, showConfigStatus, runConfigMenu } = require('./onboarding');
const { runInteractiveMenu } = require('./interactiveMenu');
const cloudArtifacts = require('./cloudArtifacts');
const fallbackExtractSection = (markdown, heading) => {
  if (!markdown) return '';
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(markdown);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\\s+/im);
  const section = next === -1 ? rest : rest.slice(0, next);
  return section.trim();
};
const extractSection = typeof cloudArtifacts.extractSection === 'function'
  ? cloudArtifacts.extractSection
  : fallbackExtractSection;
const {
  sleep,
  appendTail,
  truncateForTemporalTrace,
  randomId,
  extractJson,
  extractJsonLast,
  truncateForPrompt,
  ensureNextPrompt,
  buildNextPromptWithDecisionContext,
  ensureExplanation,
} = require('./util');
const { createCloudRunner } = require('./cloud');
const daemon = require('./daemon');
const {
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  DAEMON_STATE_FILE,
  BOARD_PID_FILE,
  BOARD_LOG_FILE,
  BOARD_ENV_FILE,
  WORKER_PID_FILE,
  WORKER_LOG_FILE,
  getTaskLogPath,
  isDaemonRunning,
  isBoardRunning,
  isTemporalWorkerRunning,
  stopDaemonProcessTree,
  ensureBoardRunning,
  stopBoard,
  ensureTemporalWorkerRunning,
  stopTemporalWorker,
  startDaemon,
  stopDaemon,
  resolveBoardDir,
  resolvePackagedAgxCloudDir,
  getBoardPort,
  probeBoardHealth,
  loadBoardEnv,
  ensureSchemaInitialized,
  resetBoardEnsured,
} = daemon;

const {
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
} = providersCli;

const {
  isLocalArtifactsEnabled,
  mapCloudStageToLocalStage,
  extractCloudProjectIdentity,
  extractCloudTaskIdentity,
  renderWorkingSetMarkdownFromCloudTask,
  createDaemonArtifactsRecorder,
  buildLocalRunIndexEntry,
  saveAugmentedPrompt,
  buildFullDaemonPromptContext,
  resolveTaskTicketType,
  parseList,
  localArtifactKey,
} = cloudArtifacts;

// Config paths
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// NOTE: AGX_SKILL, colors, CLI sanitizers, text helpers, and process wrappers live in lib/* modules.

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
// Placeholder for optional temporal signaling hook (legacy code paths call it).
const signalTemporalTask = undefined;

function logExecutionFlow(step, phase, detail = '') {
  //if (!retryFlowActive) return;
  if (['cloudRequest', 'loadCloudConfig'].includes(step)) return;
  const info = detail ? ` | ${detail}` : '';
  console.log(`[worker] ${step} | ${phase}${info}`);
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

// NOTE: commandExists/spawnCloudTaskProcess/sanitize/truncate/etc are imported above.

async function postTaskLog(taskId, content, logType) {
  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) return;

  try {
    const text = String(content ?? '');
    // Server rejects empty/whitespace-only log bodies (400). Skip to avoid noisy failures.
    if (!text.trim()) return;

    const type = (typeof logType === 'string' && logType.trim()) ? logType.trim() : 'output';
    await fetch(`${cloudConfig.apiUrl}/api/tasks/${taskId}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cloudConfig?.token ? { 'Authorization': `Bearer ${cloudConfig.token}` } : {}),
        'x-user-id': cloudConfig.userId || '',
      },
      body: JSON.stringify({ content: text, log_type: type })
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

// Cloud artifact/task identity helpers live in lib/cli/cloudArtifacts.js

const cloudRunner = createCloudRunner({
  // builtins
  fs,
  path,
  c,
  fetch: globalThis.fetch,

  // config + transport
  loadConfig,
  loadCloudConfigFile,
  postTaskLog,
  postTaskComment,

  // cli helpers
  sanitizeCliArgs,
  commandExists,
  spawnCloudTaskProcess,
  scheduleTermination,
  getProcessManager,
  pMap,
  pRetryFn,

  // orchestration helpers/constants
  logExecutionFlow,
  abortIfCancelled,
  extractCancellationReason,
  CancellationRequestedError,
  CANCELLED_ERROR_CODE,
  appendTail,
  truncateForTemporalTrace,
  randomId,
  extractJson,
  extractJsonLast,
  truncateForPrompt,
  ensureExplanation,
  ensureNextPrompt,
  buildNextPromptWithDecisionContext,
  extractFileRefsFromText,
  truncateForComment,
  cleanAgentOutputForComment,

  // stage + verification
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement,
  detectVerifyCommands,
  runVerifyCommands,
  getGitSummary,

  // local artifacts
  createDaemonArtifactsRecorder,
  buildLocalRunIndexEntry,

  // timeouts/limits
  SWARM_PROVIDERS,
  SWARM_TIMEOUT_MS,
  SWARM_RETRIES,
  SWARM_MAX_ITERS,
  SINGLE_MAX_ITERS,
  VERIFY_TIMEOUT_MS,
  VERIFY_PROMPT_MAX_CHARS,
  SWARM_LOG_FLUSH_MS,
  SWARM_LOG_MAX_BYTES,

  // optional hooks (may be undefined in this file, but present in index.js)
  signalTemporalTask,
});

const {
  patchTaskState,
  createTaskLogger,
  updateCloudTask,
  runAgxCommand,
  runSwarmIteration,
  runSingleAgentIteration,
  resolveAggregatorModel,
  buildAggregatorPrompt,
  runSingleAgentAggregate,
  runSingleAgentLoop,
  buildExecuteIterationPrompt,
  buildVerifyPrompt,
  persistIterationArtifacts,
  appendRunContainerLog,
  finalizeRunSafe,
  runSingleAgentExecuteVerifyLoop,
  runSwarmExecuteVerifyLoop,
  runSwarmAggregate,
  runSwarmLoop,
} = cloudRunner;

// ==================== DAEMON / BOARD ====================
// Implementation lives in lib/cli/daemon.js; this file just imports the public helpers.

// Provider + skill + onboarding helpers live in lib/cli/{providers,skills,onboarding}.js

// Interactive menu lives in lib/cli/interactiveMenu.js

// Check for commands or first run
async function checkOnboarding() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Version should be non-interactive and must not trigger onboarding.
  if (args.includes('--version') || args.includes('-v')) {
    try {
      const pkg = require('../../package.json');
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
    logExecutionFlow('loadCloudConfig', 'input', 'config.json cloud key');
    const config = loadCloudConfigFile();
    if (config) {
      logExecutionFlow('loadCloudConfig', 'output', 'config loaded');
    } else {
      logExecutionFlow('loadCloudConfig', 'output', 'using defaults');
    }
    return config;
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
    saveCloudConfigFile(config);
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

  async function restartTaskFromStage(taskId, stage) {
    await cloudRequest('POST', `/api/tasks/${taskId}/restart-stage`, { stage });
    console.log(`${c.green}↺${c.reset} Task ${taskId.slice(0, 8)} reset to stage ${stage}`);
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
    const { resetFirst = false, forceSwarm = false, fromStage = null } = options;
    const taskId = await resolveTaskId(rawTaskId);

    if (fromStage) {
      await restartTaskFromStage(taskId, fromStage);
    }

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
    const { buildCloudTaskTerminalPatch } = require('../cloud/status');

    const taskId = String(task?.id || '').trim();
    if (!taskId) {
      throw new Error('Queue returned task without id');
    }

    const provider = String(task?.provider || task?.engine || 'claude').toLowerCase();
    const model = typeof task?.model === 'string' && task.model.trim() ? task.model.trim() : null;
    const logger = createTaskLogger(taskId);
    const localArtifacts = isLocalArtifactsEnabled();
    const storage = localArtifacts ? require('../storage') : null;
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
        // Derive project slug from task, or auto-detect from cwd
        let derivedProjectSlug = task?.project_slug || task?.project?.slug || task?.project_name || task?.project?.name;
        if (!derivedProjectSlug) {
          // Auto-detect from cwd (git repo folder name or current folder)
          const cwd = process.cwd();
          let dir = cwd;
          while (dir !== require('path').dirname(dir)) {
            const gitPath = require('path').join(dir, '.git');
            try {
              const stat = require('fs').statSync(gitPath);
              if (stat.isDirectory() || stat.isFile()) {
                derivedProjectSlug = require('path').basename(dir);
                break;
              }
            } catch { /* continue */ }
            dir = require('path').dirname(dir);
          }
          if (!derivedProjectSlug) {
            derivedProjectSlug = require('path').basename(cwd);
          }
        }
        projectSlug = storage.slugify(derivedProjectSlug, { maxLength: 64 }) || 'untitled';
        taskSlug = storage.slugify(
          task?.slug || taskId || 'untitled',
          { maxLength: 64 }
        ) || 'untitled';

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
        lockHandle = await storage.acquireTaskLock(storage.taskRoot(projectSlug, taskSlug), { force: true });

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
      console.error(`[daemon] execution failed:`, err?.stack || message);
      logger.log('error', `[daemon] execution failed: ${message}\n${err?.stack || ''}\n`);
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

    const pm = getProcessManager();

    const requestStop = () => {
      if (stopping) return;
      stopping = true;
      console.log(`\n${c.dim}[daemon] stopping... waiting for ${inFlight.size} active task(s)${c.reset}`);
      pm.killAll();
    };

    process.on('SIGINT', requestStop);
    process.on('SIGTERM', requestStop);

    // Periodic orphan heartbeat sweep
    const orphanSweep = setInterval(() => pm.sweepOrphanedHeartbeats(), 60_000);
    orphanSweep.unref();

    console.log(`${c.green}✓${c.reset} Daemon loop started (workers=${maxWorkers}, poll=${pollMs}ms)`);

    async function runWorker(workerIndex) {
      const workerLabel = `worker-${workerIndex}`;
      while (!stopping) {
        let task = null;
        try {
          const queue = await cloudRequest('GET', '/api/queue');
          task = queue?.task || null;
        } catch (err) {
          console.error(`${c.red}[daemon][${workerLabel}] queue poll failed:${c.reset} ${err?.message || err}`);
          if (!stopping) await sleep(pollMs);
          continue;
        }

        if (!task) {
          await sleep(pollMs);
          continue;
        }

        const taskId = String(task.id || '').trim();
        if (!taskId) {
          console.error(`${c.red}[daemon][${workerLabel}] queue returned task without id${c.reset}`);
          await sleep(pollMs);
          continue;
        }

        if (inFlight.has(taskId)) {
          await sleep(pollMs);
          continue;
        }

        const execution = runCloudDaemonTask(task);
        inFlight.set(taskId, execution);
        try {
          await execution;
        } catch {
          // Errors already logged inside runCloudDaemonTask
        } finally {
          inFlight.delete(taskId);
        }
      }
    }

    const workerPromises = [];
    for (let index = 1; index <= maxWorkers; index += 1) {
      workerPromises.push(runWorker(index));
    }

    await Promise.all(workerPromises);
    clearInterval(orphanSweep);

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

  {
    const { maybeHandleCoreCommand } = require('../commands/core');
    const handled = await maybeHandleCoreCommand({
      cmd,
      args,
      ctx: {
        c,
        runOnboarding,
        runConfigMenu,
        showConfigStatus,
        handleSkillCommand,
        loadConfig,
        prompt,
        installProvider,
        loginProvider,
        commandExists,
      }
    });
    if (handled) return true;
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

  {
    const { maybeHandleLocalCommand } = require('../commands/local');
    const handled = await maybeHandleLocalCommand({ cmd, args, isLocalMode, ctx: { c } });
    if (handled) return true;
  }

  // Local-first command handlers live in lib/commands/local.js.

  // ============================================================
  // agx new "<goal>" [--provider c|g|o|x] [--project <slug>] [--run] [--json]
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
    let projectSlug = null;
    const projectIdx = args.findIndex(a => a === '--project');
    if (projectIdx !== -1 && args[projectIdx + 1]) {
      projectSlug = args[projectIdx + 1];
    } else {
      // Auto-detect project from cwd (git repo folder name or current folder)
      const cwd = process.cwd();
      let dir = cwd;
      let foundGit = false;
      while (dir !== require('path').dirname(dir)) {
        const gitPath = require('path').join(dir, '.git');
        try {
          const stat = require('fs').statSync(gitPath);
          if (stat.isDirectory() || stat.isFile()) {
            projectSlug = storage.slugify(require('path').basename(dir));
            foundGit = true;
            break;
          }
        } catch { /* continue */ }
        dir = require('path').dirname(dir);
      }
      if (!foundGit) {
        projectSlug = storage.slugify(require('path').basename(cwd));
      }
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
    const flagsToRemove = ['--json', '--run', '-r', '--provider', '-P', '--model', '-m', '--project', '--type', '--ticket-type'];
    const goalParts = [];
    for (let i = 1; i < args.length; i++) {
      if (flagsToRemove.includes(args[i])) {
        if (args[i] === '--provider' || args[i] === '-P') i++;
        if (args[i] === '--model' || args[i] === '-m') i++;
        if (args[i] === '--project') i++;
        if (args[i] === '--type' || args[i] === '--ticket-type') i++;
        continue;
      }
      goalParts.push(args[i]);
    }
    const goalText = goalParts.join(' ');

    if (!goalText) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'missing_goal', usage: 'agx new "<goal>" [--provider c] [--project <slug>] [--type spike|task] [--run]' }));
      } else {
        console.log(`${c.red}Usage:${c.reset} agx new "<goal>" [--provider c|g|o|x] [--project <slug>] [--type spike|task] [--run]`);
      }
      process.exit(1);
    }

    try {
      let projectId = null;
      if (projectSlug) {
        try {
          const project = await resolveProjectByIdentifier(projectSlug);
          projectId = project?.id || null;
        } catch (err) {
          const slug = projectSlug.trim();
          const projectErr = `Project ${slug} not found. Run agx project list to see available projects.`;
          if (jsonMode) {
            console.log(JSON.stringify({ error: projectErr }));
          } else {
            console.log(`${c.red}${projectErr}${c.reset}`);
          }
          process.exit(1);
        }
      }

      // Create task via cloud API
      const frontmatter = ['status: queued', 'stage: ideation'];
      frontmatter.push(`engine: ${provider}`);
      frontmatter.push(`provider: ${provider}`);
      if (projectSlug) frontmatter.push(`project: ${projectSlug}`);
      if (projectId) frontmatter.push(`project_id: ${projectId}`);
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
  {
    const { maybeHandleDaemonBoardCommand } = require('../commands/daemonBoard');
    const handled = await maybeHandleDaemonBoardCommand({
      cmd,
      args,
      ctx: {
        c,
        loadCloudConfig,
        runCloudDaemonLoop,
        startDaemon,
        stopDaemon,
        isDaemonRunning,
        ensureTemporalWorkerRunning,
        stopTemporalWorker,
        isTemporalWorkerRunning,
        WORKER_LOG_FILE,
        DAEMON_LOG_FILE,
        isBoardRunning,
        BOARD_LOG_FILE,
        ensureBoardRunning,
        stopBoard,
        probeBoardHealth,
        getBoardPort,
        setBoardEnsuredFalse: resetBoardEnsured,
        ensureSchemaInitialized,
        loadBoardEnv,
      }
    });
    if (handled) return true;
  }

  // ============================================================
  // CLOUD COMMANDS - Sync with agx-cloud
  // ============================================================

  // ============================================================
  // DIRECT COMMANDS - No 'cloud' prefix needed
  // ============================================================

  // agx logout
  if (cmd === 'logout') {
    clearCloudConfig();
    console.log(`${c.green}✓${c.reset} Cleared cloud configuration`);
    process.exit(0);
  }

  // agx status
  if (cmd === 'status') {
    const taskArg = args[1];
    if (taskArg && !taskArg.startsWith('-')) {
      try {
        await showCloudTaskStatus({
          taskIdentifier: taskArg,
          resolveTaskId,
          cloudRequest,
        });
      } catch (err) {
        console.log(`${c.red}✗${c.reset} ${err.message}`);
        process.exit(1);
      }
      process.exit(0);
    }

    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.yellow}Not connected to cloud${c.reset}`);
      console.log(`${c.dim}Run ${c.reset}agx config cloud-url <url>${c.dim} or set AGX_CLOUD_URL${c.reset}`);
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

  {
    const { maybeHandleProjectCommand } = require('../commands/project');
    const handledProject = await maybeHandleProjectCommand({
      cmd,
      args,
      ctx: {
        c,
        cloudRequest,
        loadCloudConfigFile,
        resolveProjectByIdentifier,
        resolveTaskId,
        collectProjectFlags,
        buildProjectBody,
        createProject,
      }
    });
    if (handledProject) return true;
  }

  {
    const { maybeHandleWorkflowCommand } = require('../commands/workflow');
    const handledWorkflow = await maybeHandleWorkflowCommand({ cmd, args, ctx: { c, cloudRequest } });
    if (handledWorkflow) return true;
  }

  // agx new "<task description>" [--project <name>] [--priority <n>] [--engine <name>]
  if (cmd === 'new' || cmd === 'push') {
    const config = loadCloudConfig();
    if (!config) {
      console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
      process.exit(1);
    }

    // Parse flags
    let projectSlug = null, projectId = null, priority = null, engine = null, provider = null, model = null, ticketType = null, createdBy = 'user';
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
      } else if (args[i] === '--ai') {
        createdBy = 'ai';
      } else {
        taskParts.push(args[i]);
      }
    }

    const taskDesc = taskParts.join(' ');
    if (!taskDesc) {
      console.log(`${c.yellow}Usage:${c.reset} agx new "<task>" [--project <slug>] [--project-slug <slug>] [--project-id <uuid>] [--priority n] [--engine claude|gemini|ollama|codex] [--type spike|task]`);
      process.exit(1);
    }

    if (projectSlug) {
      try {
        const project = await resolveProjectByIdentifier(projectSlug);
        projectId = project?.id || projectId;
      } catch (err) {
        const slug = projectSlug.trim();
        console.log(`${c.red}Project ${slug} not found. Run agx project list to see available projects.${c.reset}`);
        process.exit(1);
      }
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
    if (createdBy !== 'user') frontmatter.push(`created_by: ${createdBy}`);
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

  // agx retry <taskId> [--task <id>] [--swarm] [--async]
  if (cmd === 'retry' || (cmd === 'task' && args[1] === 'retry')) {
    const runArgs = cmd === 'task' ? args.slice(1) : args;
    retryFlowActive = true;
    logExecutionFlow('retry command', 'input', `cmd=${cmd}, args=${runArgs.slice(1).join(' ')}`);
    let taskId = null;
    let forceSwarm = false;
    let asyncMode = false;
    let fromStageArg = null;
    for (let i = 1; i < runArgs.length; i++) {
      if (runArgs[i] === '--task' || runArgs[i] === '-t') {
        taskId = runArgs[++i];
      } else if (runArgs[i] === '--swarm') {
        forceSwarm = true;
      } else if (runArgs[i] === '--async' || runArgs[i] === '-a') {
        asyncMode = true;
      } else if (runArgs[i] === '--from') {
        const candidate = runArgs[++i];
        if (!candidate || candidate.startsWith('-')) {
          console.log(`${c.red}✗${c.reset} --from requires a stage name (ideation/planning/execution/verification)`);
          process.exit(1);
        }
        fromStageArg = candidate;
      }
    }
    const normalizedFromStage = fromStageArg ? fromStageArg.trim().toLowerCase() : null;
    if (!taskId) {
      taskId = runArgs.slice(1).find(a => !a.startsWith('-'));
    }
    if (!taskId) {
      logExecutionFlow('retry command', 'output', 'missing task id');
      console.log(`${c.yellow}Usage:${c.reset} agx retry <taskId> [--from <stage>] [--task <id>] [--swarm] [--async]`);
      console.log(`${c.dim}   or:${c.reset} agx task retry <taskId> [--from <stage>] [--task <id>] [--swarm] [--async]`);
      console.log(`${c.dim}--from: Restart from ideation/planning/execution/verification${c.reset}`);
      console.log(`${c.dim}--async: Reset status and let daemon handle (non-blocking)${c.reset}`);
      process.exit(1);
    }

    try {
      // Async mode: just reset task status, daemon will pick it up
      logExecutionFlow('retry command', 'processing', `asyncMode=${asyncMode}, taskId=${taskId}`);
      if (asyncMode) {
        const resolvedId = await resolveTaskId(taskId);
        if (normalizedFromStage) {
          await restartTaskFromStage(resolvedId, normalizedFromStage);
        }
        await cloudRequest('PATCH', `/api/tasks/${resolvedId}`, {
          status: 'queued',
          started_at: null,
          completed_at: null,
        });
        console.log(`${c.green}✓${c.reset} Task ${resolvedId.slice(0, 8)} queued for retry`);
        console.log(`${c.dim}Daemon will pick it up shortly${c.reset}`);
        process.exit(0);
      }

      const exitCode = await runTaskInline(taskId, {
        resetFirst: true,
        forceSwarm,
        fromStage: normalizedFromStage,
      });
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
      const { buildCloudTaskTerminalPatch } = require('../cloud/status');

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
      let currentStage = null;
      let currentStageKey = '';

      const stageKeyFrom = (value) => {
        if (!value) return '';
        return String(value).trim().toLowerCase();
      };

      const formatStageName = (value) => {
        const normalized = String(value || '').trim();
        if (!normalized) return null;
        const segments = normalized.split(/[\s_-]+/).filter(Boolean);
        if (!segments.length) return null;
        return segments
          .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`)
          .join(' ');
      };

      const renderLogEntry = (log) => {
        const time = log?.created_at ? new Date(log.created_at).toLocaleTimeString() : new Date().toLocaleTimeString();
        const prettyStage = formatStageName(currentStage);
        const stageSegment = prettyStage ? ` ${c.cyan}[${prettyStage}]${c.reset}` : '';
        const content = log?.content || '';
        console.log(`${c.dim}[${time}]${c.reset}${stageSegment} ${content}`);
      };

      if (follow) {
        try {
          const { task: fetchedTask } = await cloudRequest('GET', `/api/tasks/${encodeURIComponent(taskId)}`);
          if (fetchedTask?.stage) {
            currentStage = fetchedTask.stage;
            currentStageKey = stageKeyFrom(fetchedTask.stage);
          }
        } catch {
          // Ignore stage fetch failures
        }
      }

      const logEntries = Array.isArray(logs) ? logs : [];
      if (logEntries.length === 0) {
        console.log(`${c.dim}No logs yet${c.reset}`);
      } else {
        console.log(`${c.bold}Task Logs${c.reset} (${logEntries.length})\n`);
        for (const log of logEntries) {
          renderLogEntry(log);
        }
      }

      const announceStageChange = (stageValue) => {
        const normalized = stageKeyFrom(stageValue);
        if (!normalized || normalized === currentStageKey) return;
        currentStage = stageValue;
        currentStageKey = normalized;
        const pretty = formatStageName(currentStage);
        if (pretty) {
          console.log(`${c.dim}Stage:${c.reset} ${c.cyan}${pretty}${c.reset}`);
        }
      };

      if (follow) {
        if (currentStageKey) {
          const prettyStage = formatStageName(currentStage);
          if (prettyStage) {
            console.log(`${c.dim}Stage:${c.reset} ${c.cyan}${prettyStage}${c.reset}`);
          }
        }

        console.log(`\n${c.cyan}→${c.reset} Tailing logs... (Ctrl+C to stop)\n`);

        const eventsourcePkg = require('eventsource');
        const EventSource = eventsourcePkg.EventSource || eventsourcePkg;
        const esOptions = {};
        if (config?.token) {
          esOptions.headers = { Authorization: `Bearer ${config.token}` };
        }
        const streamUrl = `${config.apiUrl}/api/logs/stream?taskId=${encodeURIComponent(taskId)}`;
        const es = new EventSource(streamUrl, esOptions);

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'log' && data.log?.task_id === taskId) {
              renderLogEntry(data.log);
            } else if (data.type === 'task_update' && data.task?.id === taskId) {
              announceStageChange(data.task.stage);
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
    try {
      const result = execa.commandSync('pgrep -fl "agx.*daemon" 2>/dev/null || echo \"\"', {
        shell: true,
        encoding: 'utf8',
        reject: false,
      }).stdout || '';
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
    try {
      const result = execa.commandSync('pgrep -fl "agx.*daemon" 2>/dev/null || echo \"\"', {
        shell: true,
        encoding: 'utf8',
        reject: false,
      }).stdout || '';
      if (result.trim()) {
        const pids = result.trim().split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean);
        for (const pid of pids) {
          const n = Number.parseInt(pid, 10);
          if (!Number.isFinite(n) || n <= 0) continue;
          try { process.kill(n, 'SIGTERM'); } catch { }
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
    const { readAuditLog, AUDIT_LOG_FILE } = require('../security');

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
  // ============================================================
  // agx update - Self-update and auto-update management
  // ============================================================
  if (cmd === 'update') {
    const subCmd = args[1];
    const CRON_MARKER = '# agx-auto-update';
    const CRON_SCHEDULE = '0 3 * * *'; // Daily at 3am
    const CRON_CMD = 'npm update -g @mndrk/agx';

    // Helper to get current crontab
    const getCrontab = () => {
      try {
        return execa.commandSync('crontab -l 2>/dev/null', { shell: true, encoding: 'utf8', reject: false }).stdout || '';
      } catch {
        return '';
      }
    };

    // Helper to set crontab
    const setCrontab = (content) => {
      const tmp = path.join(os.tmpdir(), `agx-crontab-${Date.now()}`);
      fs.writeFileSync(tmp, content);
      try {
        execa.commandSync(`crontab ${tmp}`, { shell: true, timeout: 5000, reject: false });
      } finally {
        try { fs.unlinkSync(tmp); } catch { }
      }
    };

    // Check if auto-update is enabled
    const isAutoEnabled = () => getCrontab().includes(CRON_MARKER);

    if (subCmd === 'status' || subCmd === '--status') {
      const pkg = require('../../package.json');
      console.log(`${c.bold}agx update status${c.reset}\n`);
      console.log(`  Current version: ${c.cyan}${pkg.version}${c.reset}`);
      console.log(`  Auto-update: ${isAutoEnabled() ? `${c.green}enabled${c.reset} (daily at 3am)` : `${c.dim}disabled${c.reset}`}`);
      process.exit(0);
    }

    if (subCmd === '--auto' || subCmd === 'auto' || subCmd === 'enable') {
      if (isAutoEnabled()) {
        console.log(`${c.yellow}⚠${c.reset} Auto-update already enabled`);
        process.exit(0);
      }
      const crontab = getCrontab();
      const newLine = `${CRON_SCHEDULE} ${CRON_CMD} ${CRON_MARKER}\n`;
      try {
        setCrontab(crontab + newLine);
        console.log(`${c.green}✓${c.reset} Auto-update enabled (daily at 3am)`);
        console.log(`  ${c.dim}To disable: agx update --off${c.reset}`);
      } catch (err) {
        console.log(`${c.yellow}⚠${c.reset} Could not modify crontab automatically.`);
        console.log(`\n  Add this line to your crontab (${c.cyan}crontab -e${c.reset}):\n`);
        console.log(`  ${c.dim}${CRON_SCHEDULE} ${CRON_CMD}${c.reset}\n`);
      }
      process.exit(0);
    }

    if (subCmd === '--off' || subCmd === 'off' || subCmd === 'disable') {
      const crontab = getCrontab();
      if (!isAutoEnabled()) {
        console.log(`${c.dim}Auto-update not enabled${c.reset}`);
        process.exit(0);
      }
      const lines = crontab.split('\n').filter(l => !l.includes(CRON_MARKER));
      try {
        setCrontab(lines.join('\n'));
        console.log(`${c.green}✓${c.reset} Auto-update disabled`);
      } catch (err) {
        console.log(`${c.yellow}⚠${c.reset} Could not modify crontab automatically.`);
        console.log(`\n  Remove the agx-auto-update line from your crontab (${c.cyan}crontab -e${c.reset})\n`);
      }
      process.exit(0);
    }

    // Default: update now
    console.log(`${c.cyan}→${c.reset} Checking for updates...`);
    try {
      const child = execa('npm', ['update', '-g', '@mndrk/agx'], {
        stdio: 'inherit',
        shell: false,
        reject: false,
      });
      const result = await child;
      if (result.exitCode === 0) {
        console.log(`${c.green}✓${c.reset} Update complete`);
      } else {
        console.log(`${c.red}✗${c.reset} Update failed`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`${c.red}✗${c.reset} Update failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (cmd === 'security') {
    const securityCmd = args[1];
    const { loadSecurityConfig, setupDaemonSecret, SECURITY_CONFIG_FILE } = require('../security');

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

// Main execution (exported for the thin index_new.js entrypoint)
async function runCli(argv = process.argv) {
  const originalArgv = process.argv;
  if (Array.isArray(argv)) process.argv = argv;
  try {
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
  agx retry <id|slug|#>  Reset + retry a task (--async for non-blocking, --from <stage> to restart at a stage)
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

    // Apply default model from config when --model is not specified
    if (!options.model) {
      const configuredModel = config?.models?.[provider] || (provider === 'ollama' ? config?.ollama?.model : null);
      if (configuredModel) options.model = configuredModel;
    }

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

      // Allow running outside a git repo (e.g. when spawned from daemon in ~/).
      translatedArgs.push('--skip-git-repo-check');

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
      const ollamaModel = options.model || config?.models?.ollama || config?.ollama?.model || 'llama3.2:3b';
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

    const cloudClient = createCloudClient({ configDir: CONFIG_DIR });
    const loadCloudConfig = cloudClient.loadConfig;
    const saveCloudConfig = cloudClient.saveConfig;
    const cloudRequest = cloudClient.request;

    // Best-effort: if local CLI settings are newer than DB settings, up-sync to cloud.
    // Non-fatal on failure (offline DB, schema missing, etc.).
    try {
      const meta = config?.settingsMeta || {};
      const cliChangedAt = typeof meta.changedAt === 'string' ? meta.changedAt : '';
      const cliChangedTs = cliChangedAt ? Date.parse(cliChangedAt) : NaN;
      const cliProvider = config?.defaultProvider || '';
      const cliModel = cliProvider
        ? (config?.models?.[cliProvider] || (cliProvider === 'ollama' ? config?.ollama?.model : null))
        : null;

      if (Number.isFinite(cliChangedTs) && cliProvider && cliModel) {
        let dbChangedTs = NaN;
        try {
          const db = await cloudRequest('GET', '/api/user-settings');
          const dbChangedAt = typeof db?.settings?.changed_at === 'string' ? db.settings.changed_at : '';
          dbChangedTs = dbChangedAt ? Date.parse(dbChangedAt) : NaN;
        } catch { }

        if (!Number.isFinite(dbChangedTs) || cliChangedTs > dbChangedTs) {
          await cloudRequest('PUT', '/api/user-settings', {
            default_provider: cliProvider,
            default_model: cliModel,
            models: config?.models || { [cliProvider]: cliModel },
            provenance: 'cli',
            changed_at: cliChangedAt,
          });
        }
      }
    } catch { }

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
        let hasTaskPrompt = typeof task?.prompt === 'string' && task.prompt.trim();
        if (!hasTaskPrompt) {
          const inferredPrompt = buildCloudTaskPromptFromContext(task);
          if (inferredPrompt) {
            task.prompt = inferredPrompt;
            hasTaskPrompt = true;
          }
        }
        let plan = '';
        let todo = '';
        let checkpoints = '';
        let learnings = '';
        let stagePrompt = '';
        let stageRequirement = '';

        if (!hasTaskPrompt) {
          const sectionExtractor = (typeof extractSection === 'function')
            ? extractSection
            : fallbackExtractSection;

          plan = sectionExtractor(task.content, 'Plan');
          todo = sectionExtractor(task.content, 'Todo') || sectionExtractor(task.content, 'TODO');
          checkpoints = sectionExtractor(task.content, 'Checkpoints');
          learnings = sectionExtractor(task.content, 'Learnings');

          const stageKey = task?.stage || 'unknown';
          stagePrompt = resolveStageObjective(task, stageKey, '');
          stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
        }

        const runContext = {
          run_root: process.env.AGX_RUN_ROOT || '',
          plan_dir: process.env.AGX_RUN_PLAN_DIR || '',
          artifacts_dir: process.env.AGX_RUN_ARTIFACTS_DIR || '',
        };

        const augmentedPrompt = buildContinueCloudTaskPrompt({
          task,
          taskComments,
          finalPrompt,
          stagePrompt,
          stageRequirement,
          extracted: { plan, todo, checkpoints, learnings },
          runContext,
        });

        const promptIndex = translatedArgs.indexOf(finalPrompt);
        if (promptIndex !== -1) {
          translatedArgs[promptIndex] = augmentedPrompt;
        } else {
          translatedArgs.push(augmentedPrompt);
        }
        saveAugmentedPrompt(augmentedPrompt, options.debug);

        // For codex: add --writable-roots for each project repo path so the sandbox allows access.
        if (provider === 'codex') {
          const projectObj = task?.project && typeof task.project === 'object' ? task.project : null;
          const projectCtx = task?.project_context && typeof task.project_context === 'object' ? task.project_context : null;
          const repos = projectCtx?.repos || projectObj?.repos || task?.repos || [];
          if (Array.isArray(repos)) {
            for (const repo of repos) {
              if (repo?.path) {
                translatedArgs.push('--add-dir', repo.path);
              }
            }
          }
        }

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

          const augmentedPrompt = buildNewAutonomousCloudTaskPrompt({
            task,
            taskComments,
            finalPrompt,
            stagePrompt,
            stageRequirement,
          });

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
      const childProc = execa(cmd, args, { reject: false, ...spawnOpts });
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

      const child = execa(command, firstArgs, {
        env,
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
        reject: false,
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

  } finally {
    process.argv = originalArgv;
  }
}

module.exports = { runCli };

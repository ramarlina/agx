/* eslint-disable no-console */
'use strict';

function createCloudTaskHelpers(env) {
  const {
    loadCloudConfigFile,
    loadConfig,
    fetch,
    logExecutionFlow,
    postTaskLog,
    postTaskComment,
    SWARM_LOG_FLUSH_MS,
    SWARM_LOG_MAX_BYTES,
    appendTail,
  } = env || {};

  function readTaskSectionSettings() {
    // Prefer ~/.agx/config.json over env vars.
    // Example:
    // {
    //   "taskSectionUpdates": { "enabled": false, "flushMs": 2000 }
    // }
    //
    // Historical note: this used to PUT "## Output"/"## Error" into task.content.
    // That mutates user-authored task content, so we now post output tails as task comments instead.
    const cfg = typeof loadConfig === 'function' ? loadConfig() : null;
    const sectionCfg = cfg?.taskSectionUpdates || cfg?.daemon?.taskSectionUpdates || null;

    const enabledFromConfig = typeof sectionCfg?.enabled === 'boolean' ? sectionCfg.enabled : null;
    const flushMsFromConfig = Number.isFinite(Number(sectionCfg?.flushMs)) ? Number(sectionCfg.flushMs) : null;

    // Back-compat: allow env override if set.
    const enabledFromEnv = process.env.AGX_TASK_SECTION_UPDATES ? (String(process.env.AGX_TASK_SECTION_UPDATES) === '1') : null;
    const flushMsFromEnv = process.env.AGX_TASK_SECTION_FLUSH_MS && Number.isFinite(Number(process.env.AGX_TASK_SECTION_FLUSH_MS))
      ? Number(process.env.AGX_TASK_SECTION_FLUSH_MS)
      : null;

    const enabled = enabledFromEnv ?? enabledFromConfig ?? false;
    const flushMs = flushMsFromEnv ?? flushMsFromConfig ?? 2000;
    return { enabled, flushMs };
  }

  function normalizeTailChunk(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk || '');
    // Reduce churn from TTY control sequences and carriage returns.
    // This is only used for the small "tail" that gets posted as task comments.
    return text
      .replace(/\r/g, '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  }

  function computeTailDelta(prevTail, nextTail) {
    const prev = String(prevTail || '');
    const next = String(nextTail || '');
    if (!prev) return next;
    if (!next) return '';
    if (next.startsWith(prev)) return next.slice(prev.length);

    // Best-effort overlap: find longest suffix of prev that is a prefix of next.
    const max = Math.min(prev.length, next.length);
    for (let i = max; i > 0; i -= 1) {
      if (prev.slice(-i) === next.slice(0, i)) return next.slice(i);
    }
    return next;
  }

  function wrapInCodeFence(text, lang = 'text') {
    const raw = String(text ?? '');
    const matches = raw.match(/`+/g) || [];
    const maxRun = matches.reduce((m, s) => Math.max(m, s.length), 0);
    const fence = '`'.repeat(Math.max(3, maxRun + 1));
    return `${fence}${lang ? String(lang) : ''}\n${raw}\n${fence}`;
  }

  function formatTailComment(label, delta) {
    const body = String(delta || '');
    if (!body.trim()) return '';
    return `**${label} (tail)**\n\n${wrapInCodeFence(body, 'text')}\n`;
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
    const { enabled: enableTailComments, flushMs: tailCommentFlushMs } = readTaskSectionSettings();
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
    const sectionTimers = {
      output: null,
      error: null,
    };
    const lastSection = {
      output: '',
      error: '',
    };
    let updateChain = Promise.resolve();

    const scheduleFlush = (type) => {
      if (timers[type]) return;
      timers[type] = setTimeout(() => flush(type), SWARM_LOG_FLUSH_MS);
    };

    const scheduleSectionUpdate = (type) => {
      if (!enableTailComments) return;
      if (typeof postTaskComment !== 'function') return;
      if (sectionTimers[type]) return;
      sectionTimers[type] = setTimeout(() => {
        sectionTimers[type] = null;
        const label = type === 'output' ? 'Output' : 'Error';
        const nextTail = tails[type] || '';
        if (!nextTail) return;
        if (nextTail === lastSection[type]) return;
        const delta = computeTailDelta(lastSection[type], nextTail);
        lastSection[type] = nextTail;
        const comment = formatTailComment(label, delta);
        if (!comment) return;
        updateChain = updateChain.then(() => postTaskComment(taskId, comment));
      }, tailCommentFlushMs);
    };

    const flushSectionUpdates = async () => {
      if (!enableTailComments) return;
      if (typeof postTaskComment !== 'function') return;
      for (const type of ['output', 'error']) {
        if (sectionTimers[type]) {
          clearTimeout(sectionTimers[type]);
          sectionTimers[type] = null;
        }
        const label = type === 'output' ? 'Output' : 'Error';
        const nextTail = tails[type] || '';
        if (!nextTail) continue;
        if (nextTail === lastSection[type]) continue;
        const delta = computeTailDelta(lastSection[type], nextTail);
        lastSection[type] = nextTail;
        const comment = formatTailComment(label, delta);
        if (!comment) continue;
        updateChain = updateChain.then(() => postTaskComment(taskId, comment));
      }
      await updateChain.catch(() => { });
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

    const log = (type, data) => {
      const chunk = Buffer.isBuffer(data) ? data.toString() : String(data || '');

      if (type === 'output' || type === 'error') {
        tails[type] = appendTail(tails[type], normalizeTailChunk(chunk), SWARM_LOG_MAX_BYTES);
        buffers[type] += chunk;
      } else {
        buffers[type] += chunk;
      }

      // Keep the main task content updated with smaller tails (avoid huge PUT),
      // but debounce updates to avoid a PUT per output chunk.
      if (type === 'output') scheduleSectionUpdate('output');
      if (type === 'error') scheduleSectionUpdate('error');

      scheduleFlush(type);
    };

    const flushAll = async () => {
      await flushSectionUpdates();
      await Promise.all(Object.keys(buffers).map((t) => flush(t)));
    };

    return { log, flushAll };
  }

  return { patchTaskState, createTaskLogger };
}

module.exports = { createCloudTaskHelpers };

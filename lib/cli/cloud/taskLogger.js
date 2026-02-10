/* eslint-disable no-console */
'use strict';

function createCloudTaskHelpers(env) {
  const {
    loadCloudConfigFile,
    fetch,
    logExecutionFlow,
    postTaskLog,
    SWARM_LOG_FLUSH_MS,
    SWARM_LOG_MAX_BYTES,
    appendTail,
  } = env || {};

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
        }
      } catch (err) {
        logExecutionFlow('updateTaskSection', 'output', `failed ${err?.message || err}`);
      }
    };

    const log = (type, data) => {
      const chunk = Buffer.isBuffer(data) ? data.toString() : String(data || '');

      if (type === 'output' || type === 'error') {
        tails[type] = appendTail(tails[type], chunk, SWARM_LOG_MAX_BYTES);
        buffers[type] += chunk;
      } else {
        buffers[type] += chunk;
      }

      // Keep the main task content updated with smaller tails (avoid huge PUT).
      if (type === 'output') {
        updateChain = updateChain.then(() => updateTaskSection('Output', tails.output, 'replace'));
      }
      if (type === 'error') {
        updateChain = updateChain.then(() => updateTaskSection('Error', tails.error, 'replace'));
      }

      scheduleFlush(type);
    };

    const flushAll = async () => {
      await updateChain.catch(() => { });
      await Promise.all(Object.keys(buffers).map((t) => flush(t)));
    };

    return { log, flushAll };
  }

  return { patchTaskState, createTaskLogger };
}

module.exports = { createCloudTaskHelpers };


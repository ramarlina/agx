/* eslint-disable no-console */
'use strict';

const { interpolate, AGGREGATOR_PROMPT, EXECUTE_ITERATION, VERIFY_PROMPT } = require('../../prompts/templates');

function createCloudPromptHelpers(env) {
  const { path, truncateForPrompt, VERIFY_PROMPT_MAX_CHARS } = env || {};

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

    return interpolate(AGGREGATOR_PROMPT, {
      role,
      taskId,
      title: task?.title || taskId,
      stage: task?.stage || 'unknown',
      taskTitle: task?.title,
      taskContent: task?.content,
      taskComments: taskComments.map(c => `${c.author}: ${c.content}`).join('\n'),
      stagePrompt,
      stageRequirement,
      runRoot: runRoot || '(not available)',
      runFiles,
      refsBlock,
    });
  }

  function truncateForPromptLocal(text, maxChars) {
    const value = String(text || '');
    const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 6000;
    if (value.length <= cap) return value;
    return `${value.slice(0, cap)}\n[truncated]`;
  }

  function buildExecuteIterationPrompt(nextPrompt, iteration) {
    const instruction = typeof nextPrompt === 'string' && nextPrompt.trim()
      ? nextPrompt.trim()
      : 'Pick the next concrete step and implement it.';

    return interpolate(EXECUTE_ITERATION, {
      iteration,
      instruction,
    });
  }

  function buildVerifyPrompt({ taskId, task, stagePrompt, stageRequirement, gitSummary, verifyResults, iteration, lastRunPath, agentOutput }) {
    const title = String(task?.title || taskId || '').trim();
    const contentRaw = String(task?.content || '').trim();
    const content = contentRaw.length > 2500 ? `${contentRaw.slice(0, 2500)}\n[truncated]` : contentRaw;

    const agentOutputRaw = agentOutput ? String(agentOutput).trim() : '';
    const agentOutputShort = agentOutputRaw.length > 3000 ? `${agentOutputRaw.slice(-3000)}\n[truncated to last 3000 chars]` : agentOutputRaw;

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

    const prompt = interpolate(VERIFY_PROMPT, {
      taskId,
      title: title || taskId,
      stage: task?.stage || 'unknown',
      iteration,
      stagePrompt,
      stageRequirement,
      runRoot: runRoot || '(not available)',
      requestTitle: title,
      requestContent: content,
      statusShort: statusShort || '(none)',
      diffShort: diffShort || '(none)',
      cmdLines,
      agentOutputShort: agentOutputShort || '(not available)',
    });

    return (typeof truncateForPrompt === 'function'
      ? truncateForPrompt(prompt, VERIFY_PROMPT_MAX_CHARS)
      : truncateForPromptLocal(prompt, VERIFY_PROMPT_MAX_CHARS));
  }

  return {
    resolveAggregatorModel,
    buildAggregatorPrompt,
    truncateForPrompt: truncateForPromptLocal,
    buildExecuteIterationPrompt,
    buildVerifyPrompt,
  };
}

module.exports = { createCloudPromptHelpers };

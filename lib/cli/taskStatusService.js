'use strict';

const { c: defaultColors } = require('../ui/colors');

function sanitizeTaskIdentifier(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/^#+/, '').trim();
}

function formatTimestamp(iso) {
  if (!iso) return 'unknown';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

async function fetchRecentTaskLogs({
  cloudRequest,
  taskId,
  tail = 10,
  logger = console,
  colors = defaultColors,
}) {
  try {
    const payload = await cloudRequest('GET', `/api/tasks/${encodeURIComponent(taskId)}/logs?tail=${tail}`);
    if (Array.isArray(payload?.logs)) return payload.logs;
  } catch (err) {
    logger.log(`${colors.yellow}Warning:${colors.reset} Could not fetch logs: ${err?.message || err}`);
  }
  return [];
}

function buildTaskStatusLines(task, logs, options = {}) {
  const colors = options.colors || defaultColors;
  const formatFn = options.formatTimestamp || formatTimestamp;
  const lines = [];

  const title = (task.title || '').trim() || task.slug || task.id;
  lines.push(`${colors.bold}${title}${colors.reset}  ${colors.dim}[${task.status || 'unknown'} | ${task.stage || 'unknown'}]${colors.reset}`);
  lines.push(`${colors.cyan}Task ID:${colors.reset} ${task.id}`);
  lines.push('');

  const desc = (task.description || '').trim();
  if (desc) {
    lines.push(`${colors.cyan}Description:${colors.reset}`);
    const descLines = desc
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (descLines.length === 0) {
      lines.push(`  ${colors.dim}(description is empty)${colors.reset}`);
    } else {
      descLines.forEach((line) => lines.push(`  ${line}`));
    }
  } else {
    lines.push(`${colors.cyan}Description:${colors.reset} ${colors.dim}(none)${colors.reset}`);
  }

  lines.push('');
  lines.push(`${colors.cyan}Stage:${colors.reset} ${task.stage || 'unknown'}`);
  lines.push(`${colors.cyan}Status:${colors.reset} ${task.status || 'unknown'}`);
  lines.push(`${colors.cyan}Updated:${colors.reset} ${formatFn(task.updated_at)}`);
  const provider = task.resolved_provider || task.provider || task.engine || 'unknown';
  const model = task.resolved_model || task.model || 'default';
  lines.push(`${colors.cyan}Provider / Model:${colors.reset} ${provider} / ${model}`);
  const projectCtx = task.project_context?.project;
  if (projectCtx) {
    lines.push(`${colors.cyan}Project:${colors.reset} ${projectCtx.name} [${projectCtx.slug}]`);
  } else if (task.project || task.project_id) {
    lines.push(`${colors.cyan}Project:${colors.reset} ${task.project || task.project_id}`);
  }

  lines.push('');
  lines.push(`${colors.cyan}Stage History:${colors.reset}`);
  const runIndex = Array.isArray(task.run_index) ? task.run_index : [];
  const sortedHistory = runIndex
    .slice()
    .filter(Boolean)
    .sort((a, b) => {
      const aTs = Date.parse(a?.created_at || '') || 0;
      const bTs = Date.parse(b?.created_at || '') || 0;
      return aTs - bTs;
    });
  const historySlice = sortedHistory.slice(-10);
  if (!historySlice.length) {
    lines.push(`  ${colors.dim}(none yet)${colors.reset}`);
  } else {
    historySlice.forEach((entry) => {
      const timestamp = formatFn(entry.created_at);
      const stageLabel = entry.stage || 'unknown';
      const statusLabel = entry.status || 'unknown';
      const runId = entry.run_id ? `Run ${entry.run_id}` : 'Run unknown';
      lines.push(`  ${timestamp}  ${stageLabel} (${statusLabel}) ${colors.dim}${runId}${colors.reset}`);
    });
  }

  lines.push('');
  lines.push(`${colors.cyan}Recent Logs:${colors.reset}`);
  if (!logs || !logs.length) {
    lines.push(`  ${colors.dim}(no logs)${colors.reset}`);
  } else {
    logs.slice(-10).forEach((log) => {
      const timestamp = formatFn(log.created_at);
      const logType = log.log_type || 'log';
      lines.push(`  ${timestamp} ${colors.dim}[${logType}]${colors.reset}`);
      const contentLines = String(log.content || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (contentLines.length === 0) {
        lines.push(`    ${colors.dim}(empty log entry)${colors.reset}`);
      } else {
        const maxLines = 3;
        for (let idx = 0; idx < Math.min(contentLines.length, maxLines); idx += 1) {
          let line = contentLines[idx];
          if (line.length > 200) {
            line = `${line.slice(0, 200)}…`;
          }
          lines.push(`    ${line}`);
        }
        if (contentLines.length > maxLines) {
          lines.push(`    ${colors.dim}...${colors.reset}`);
        }
      }
    });
  }

  return lines;
}

async function showCloudTaskStatus({
  taskIdentifier,
  resolveTaskId,
  cloudRequest,
  fetchLogs = fetchRecentTaskLogs,
  logger = console,
  colors = defaultColors,
  formatTimestamp: formatFn = formatTimestamp,
}) {
  const normalized = sanitizeTaskIdentifier(taskIdentifier);
  if (!normalized) {
    throw new Error('Task identifier is required for `agx status <task>`');
  }

  let resolvedTaskId;
  try {
    resolvedTaskId = await resolveTaskId(normalized);
  } catch (err) {
    throw new Error(`Failed to resolve task "${normalized}": ${err?.message || err}`);
  }

  let taskResponse;
  try {
    taskResponse = await cloudRequest('GET', `/api/tasks/${encodeURIComponent(resolvedTaskId)}`);
  } catch (err) {
    throw new Error(`Could not fetch task ${normalized}: ${err?.message || err}`);
  }

  const task = taskResponse?.task;
  if (!task) {
    throw new Error(`Task not found: ${normalized}`);
  }

  const logs = await fetchLogs({
    cloudRequest,
    taskId: resolvedTaskId,
    tail: 10,
    logger,
    colors,
  });

  const lines = buildTaskStatusLines(task, logs, { colors, formatTimestamp: formatFn });
  lines.forEach((line) => logger.log(line));
}

module.exports = {
  sanitizeTaskIdentifier,
  formatTimestamp,
  fetchRecentTaskLogs,
  buildTaskStatusLines,
  showCloudTaskStatus,
};

/* eslint-disable no-console */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

  return {
    projectId: projectId ? String(projectId) : null,
    projectSlug: projectSlug ? String(projectSlug) : null,
    projectName: projectName ? String(projectName) : null
  };
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
  if (!baseCloudId && projectId) {
    return base;
  }
  if (baseCloudId && projectId && baseCloudId === projectId) {
    return base;
  }

  const suffix = projectId ? shortStableHex(projectId, 6) : shortStableHex(`${label}:${process.cwd()}:${Date.now()}`, 6);
  const trimmedBase = storage.slugify(label, { maxLength: 64 - (1 + suffix.length) });
  let candidate = `${trimmedBase}-${suffix}`;

  for (let i = 0; i < 200; i += 1) {
    const s = await storage.readProjectState(candidate);
    if (!s) return candidate;
    const cid = s?.cloud?.project_id ? String(s.cloud.project_id) : null;
    if (projectId && cid === projectId) return candidate;
    candidate = `${trimmedBase}-${suffix}-${i + 1}`;
  }

  return `${trimmedBase}-${suffix}-${crypto.randomBytes(2).toString('hex')}`;
}

async function resolveLocalTaskSlugForCloudTask(storage, projectSlug, task) {
  const { taskId, taskSlug: cloudTaskSlug } = extractCloudTaskIdentity(task);
  const label = cloudTaskSlug || taskId;
  const desired = storage.slugify(label, { maxLength: 64 });

  const existing = await storage.readTaskState(projectSlug, desired);
  if (!existing) return desired;

  const existingCloudTaskId = existing?.cloud?.task_id ? String(existing.cloud.task_id) : null;
  if (!existingCloudTaskId && taskId) return desired;
  if (existingCloudTaskId && taskId && existingCloudTaskId === taskId) return desired;

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
  const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.agx');
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
  const stagePrompt = typeof options.resolveStageObjective === 'function'
    ? options.resolveStageObjective(task, stageKey, '')
    : '';
  const stageRequirement = typeof options.buildStageRequirementPrompt === 'function'
    ? options.buildStageRequirementPrompt({ stage: stageKey, stagePrompt })
    : '';

  const commentsSection = comments.length > 0
    ? comments.map((c) => `${c.author || 'user'}: ${c.content || ''}`).join('\n')
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
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch { }
  }
  return trimmed
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

module.exports = {
  isLocalArtifactsEnabled,
  mapCloudStageToLocalStage,
  extractCloudProjectIdentity,
  extractCloudTaskIdentity,
  resolveLocalProjectSlugForCloudTask,
  resolveLocalTaskSlugForCloudTask,
  renderWorkingSetMarkdownFromCloudTask,
  createDaemonArtifactsRecorder,
  buildLocalRunIndexEntry,
  saveAugmentedPrompt,
  buildFullDaemonPromptContext,
  resolveTaskTicketType,
  parseList,
};


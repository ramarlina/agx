const { interpolate, CONTINUE_CLOUD_TASK, NEW_AUTONOMOUS_CLOUD_TASK, LEGACY_INSTRUCTION_FOOTER } = require('./templates');

function stripMarkdownSection(markdown, heading) {
  if (!markdown) return '';
  const h = String(heading || '').trim();
  if (!h) return String(markdown || '');

  // Remove "## Heading ... until next ##" blocks to prevent prompt self-reinforcement
  // when agent output is persisted into the task content.
  const sectionRegex = new RegExp(
    `^##\\s+${h.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$[\\s\\S]*?(?=^##\\s+|\\Z)`,
    'gim'
  );
  return String(markdown || '').replace(sectionRegex, '').trim();
}

function collapseBlankLines(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeTaskContentForPrompt(content) {
  // Critical: don't inline the continuously-updated sections (Output/Error) into the prompt.
  // Otherwise every iteration includes prior agent output, which tends to explode the context.
  let out = String(content || '').replace(/\r/g, '');

  // First, drop known noisy sections if present.
  out = stripMarkdownSection(out, 'Output');
  out = stripMarkdownSection(out, 'Error');
  out = stripMarkdownSection(out, 'Cloud Task Context');
  out = stripMarkdownSection(out, 'Extracted State');
  out = stripMarkdownSection(out, 'Instructions');

  // Then, keep only the preamble (everything before the first "##" heading).
  // Task bodies are expected to keep the user-facing request up top, with
  // derived/agent/system sections below.
  const firstSubheading = out.search(/^##\s+/m);
  if (firstSubheading !== -1) {
    out = out.slice(0, firstSubheading);
  }

  // Hard cap to avoid accidental large prompts from corrupted content.
  const MAX_CHARS = 8000;
  if (out.length > MAX_CHARS) out = out.slice(0, MAX_CHARS);
  return collapseBlankLines(out);
}

function resolveTaskPromptBody(task) {
  const description = String(task?.description || '').trim();
  if (description) return description;
  return sanitizeTaskContentForPrompt(task?.content);
}

function buildContinueCloudTaskPrompt({
  task,
  taskComments,
  finalPrompt,
  stagePrompt,
  stageRequirement,
  extracted,
  runContext,
}) {
  const plan = extracted?.plan || '';
  const todo = extracted?.todo || '';
  const checkpoints = extracted?.checkpoints || '';
  const learnings = extracted?.learnings || '';
  const runRoot = typeof runContext?.run_root === 'string' ? runContext.run_root.trim() : '';
  const planDir = typeof runContext?.plan_dir === 'string' ? runContext.plan_dir.trim() : '';
  const artifactsDir = typeof runContext?.artifacts_dir === 'string' ? runContext.artifacts_dir.trim() : '';

  const hasTaskPrompt = typeof task?.prompt === 'string' && task.prompt.trim();
  let augmentedPrompt = hasTaskPrompt ? task.prompt.trim() : interpolate(CONTINUE_CLOUD_TASK, {
    id: task.id,
    title: task.title || 'Untitled',
    stage: task.stage || 'intake',
    stagePrompt,
    stageRequirement,
    taskTitle: task?.title,
    taskContent: resolveTaskPromptBody(task),
    taskComments: (taskComments || []).map(c => `${c.author}: ${c.content}`).join('\n'),
    goal: task.title || 'Untitled',
    plan: plan || '(none)',
    todo: todo || '(none)',
    checkpoints: checkpoints || '(none)',
    learnings: learnings || '(none)',
  });

  if (!hasTaskPrompt && task?.engine) {
    augmentedPrompt += `Engine: ${task.engine}\n`;
  }

  augmentedPrompt += `\n\n${buildLegacyInstructionFooter({
    runContext: { runRoot, planDir, artifactsDir },
    finalPrompt,
  })}`;

  return augmentedPrompt;
}

function buildCloudTaskPromptFromContext(task) {
  if (!task || typeof task !== 'object') return '';

  const stagePrompt = task.stage_prompt || task.stagePrompt || '';
  const comments = Array.isArray(task.comments) ? task.comments : [];
  const learnings = task.learnings || { task: [], project: [], global: [] };
  const projectContext = task.project_context || null;

  const description = (task.description || extractBodyFromContent(task.content || '')).trim();
  const provider = task.resolved_provider || task.provider || task.engine || 'unspecified';
  const model = task.resolved_model || task.model || '';
  const swarm = task.resolved_swarm ?? task.swarm ?? false;
  const swarmModels = Array.isArray(task.resolved_swarm_models)
    ? task.resolved_swarm_models
    : Array.isArray(task.swarm_models)
      ? task.swarm_models
      : [];

  const metaLines = [
    `Title: ${task.title || 'Untitled'}`,
    `Slug: ${task.slug || 'unspecified'}`,
    `Stage: ${task.stage || 'intake'}`,
    `Project: ${task.project || 'none'}`,
    `Engine: ${task.engine || provider || 'unspecified'}`,
    `Provider: ${provider}`,
    `Model: ${model}`,
    `Swarm: ${swarm ? 'true' : 'false'}`,
    `Swarm Models: ${swarmModels.length ? swarmModels.map((m) => `${m.provider}:${m.model}`).join(', ') : 'none'}`,
  ];

  const commentLines = comments
    .filter((comment) => isPromptRelevantComment(comment?.content))
    .map((comment) => {
      const when = comment?.created_at ? new Date(comment.created_at).toISOString() : 'unknown-time';
      const author = comment?.author_type === 'agent' ? 'agent' : 'user';
      return `[${when}] (${author}) ${comment?.content || ''}`;
    });

  const projectSections = projectContext?.project
    ? [
      `PROJECT CONTEXT\n${formatProjectMetadata(projectContext.project)}`,
      `REPOSITORY MAP\n${formatRepoLines(projectContext.repos || [])}`,
      `PROJECT LEARNINGS\n${formatList(projectContext.learnings || [], '(none)')}`,
    ]
    : [];

  const sections = [
    stagePrompt ? `STAGE PROMPT\n${stagePrompt}` : null,
    'WORK RULES\n- Do not use AGX MCP tools or AGX MCP servers for this task.\n- Complete work using local edits, shell commands, and allowed HTTP APIs only.',
    `TASK META\n${metaLines.join('\n')}`,
    `TASK\n${description || '(empty)'}`,
    `COMMENTS\n${formatList(commentLines, '(none)')}`,
    ...projectSections,
    `LEARNINGS (task)\n${formatList((learnings.task || []).map((l) => l.content || ''), '(none)')}`,
    `LEARNINGS (project)\n${formatList((learnings.project || []).map((l) => l.content || ''), '(none)')}`,
    `LEARNINGS (global)\n${formatList((learnings.global || []).map((l) => l.content || ''), '(none)')}`,
  ].filter(Boolean);

  return sections.join('\n\n');
}

function buildNewAutonomousCloudTaskPrompt({
  task,
  taskComments,
  finalPrompt,
  stagePrompt,
  stageRequirement,
}) {
  return interpolate(NEW_AUTONOMOUS_CLOUD_TASK, {
    id: task.id,
    title: task.title || finalPrompt,
    stage: task.stage,
    stagePrompt,
    stageRequirement,
    taskTitle: task?.title,
    taskContent: resolveTaskPromptBody(task),
    taskComments: (taskComments || []).map(c => `${c.author}: ${c.content}`).join('\n'),
    finalPrompt,
  });
}

module.exports = {
  buildContinueCloudTaskPrompt,
  buildNewAutonomousCloudTaskPrompt,
  buildLegacyInstructionFooter,
  buildCloudTaskPromptFromContext,
};

function buildLegacyInstructionFooter({ runContext, finalPrompt } = {}) {
  const runRoot = typeof runContext?.runRoot === 'string' ? runContext.runRoot.trim() : '';
  const planDir = typeof runContext?.planDir === 'string' ? runContext.planDir.trim() : '';
  const artifactsDir = typeof runContext?.artifactsDir === 'string' ? runContext.artifactsDir.trim() : '';

  const runPaths = (runRoot || planDir || artifactsDir)
    ? `\nLocal run paths (scratch space):\n- Run root: ${runRoot || '(unset)'}\n- Plan dir: ${planDir || '(unset)'}\n- Artifacts dir: ${artifactsDir || '(unset)'}\n\nPrefer writing scratch notes under the run's Plan dir to avoid polluting the repo.\n`
    : '';

  return interpolate(LEGACY_INSTRUCTION_FOOTER, {
    runPaths,
    finalPrompt: finalPrompt ? `Your specific task: ${finalPrompt}` : '',
  }).trim();
}

function extractBodyFromContent(content) {
  if (!content) return '';
  const match = String(content).match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function isPromptRelevantComment(content) {
  const normalized = String(content || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('[execution/')) return false;
  if (normalized.startsWith('Execution result from agx')) return false;
  return true;
}

function formatList(items, emptyLabel) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safe.length) return emptyLabel;
  return safe.map((item) => `- ${item}`).join('\n');
}

function formatProjectMetadata(project) {
  if (!project) return '(none)';
  const lines = [];
  if (project.name) lines.push(`Name: ${project.name}`);
  if (project.slug) lines.push(`Slug: ${project.slug}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.ci_cd_info) lines.push(`CI/CD: ${project.ci_cd_info}`);
  if (project.workflow_id) lines.push(`Workflow: ${project.workflow_id}`);
  if (project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)) {
    const entries = Object.entries(project.metadata);
    if (entries.length) {
      lines.push('Metadata:');
      entries.forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }
  }
  return lines.length ? lines.join('\n') : '(none)';
}

function formatRepoLines(repos) {
  if (!Array.isArray(repos) || repos.length === 0) return '(none)';
  return repos
    .map((repo) => {
      const parts = [repo?.name || '(unnamed repo)'];
      if (repo?.path) parts.push(`path: ${repo.path}`);
      if (repo?.git_url) parts.push(`git_url: ${repo.git_url}`);
      if (repo?.notes) parts.push(`notes: ${repo.notes}`);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

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
  let augmentedPrompt = hasTaskPrompt ? task.prompt.trim() : `## Cloud Task Context

You are continuing a cloud task. Here is the current state:

Task ID: ${task.id}
Title: ${task.title || 'Untitled'}
Stage: ${task.stage || 'ideation'}
Stage Objective: ${stagePrompt}
Stage Completion Requirement: ${stageRequirement}

	User Request: 
	"""
	${task?.title}
	${sanitizeTaskContentForPrompt(task?.content)}
	---
	Task Thread:
	${(taskComments || []).map(c => `${c.author}: ${c.content}`).join('\n')}
	"""

## Extracted State

Goal: ${task.title || 'Untitled'}
Plan: ${plan || '(none)'}
Todo: ${todo || '(none)'}
Checkpoints: ${checkpoints || '(none)'}
Learnings: ${learnings || '(none)'}

`;

  if (!hasTaskPrompt && task?.engine) {
    augmentedPrompt += `Engine: ${task.engine}\n`;
  }

  augmentedPrompt += `\n\n${buildLegacyInstructionFooter({
    runContext: { runRoot, planDir, artifactsDir },
    finalPrompt,
  })}`;

  return augmentedPrompt;
}

function buildNewAutonomousCloudTaskPrompt({
  task,
  taskComments,
  finalPrompt,
  stagePrompt,
  stageRequirement,
}) {
  return `## Cloud Task Context

	Task ID: ${task.id}
	Title: ${task.title || finalPrompt}
	Stage: ${task.stage}
	Stage Objective: ${stagePrompt}
	Stage Completion Requirement: ${stageRequirement}

	User Request: 
	"""
	${task?.title}
	${sanitizeTaskContentForPrompt(task?.content)}
	---
	Task Thread:
	${(taskComments || []).map(c => `${c.author}: ${c.content}`).join('\n')}
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
}

module.exports = {
  buildContinueCloudTaskPrompt,
  buildNewAutonomousCloudTaskPrompt,
  buildLegacyInstructionFooter,
};

function buildLegacyInstructionFooter({ runContext, finalPrompt } = {}) {
  const runRoot = typeof runContext?.runRoot === 'string' ? runContext.runRoot.trim() : '';
  const planDir = typeof runContext?.planDir === 'string' ? runContext.planDir.trim() : '';
  const artifactsDir = typeof runContext?.artifactsDir === 'string' ? runContext.artifactsDir.trim() : '';

  return `## Instructions

Continue working on this task. Use the cloud API to sync progress.
Respect the Stage Completion Requirement before using [complete] or [done].

${(runRoot || planDir || artifactsDir) ? `\nLocal run paths (scratch space):\n- Run root: ${runRoot || '(unset)'}\n- Plan dir: ${planDir || '(unset)'}\n- Artifacts dir: ${artifactsDir || '(unset)'}\n\nPrefer writing scratch planning docs under the run's Plan dir to avoid polluting the repo.\n` : ''}

To update the task:
- [done] - Mark task complete
- [complete: message] - Complete current stage
- [log: message] - Add a log entry
- [checkpoint: message] - Save progress checkpoint
- [learn: insight] - Record a learning
- [plan: text] - Update plan
- [todo: text] - Update todo list

${finalPrompt ? `Your specific task: ${finalPrompt}` : ''}`.trim();
}

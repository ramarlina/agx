function buildContinueCloudTaskPrompt({
  task,
  taskComments,
  finalPrompt,
  stagePrompt,
  stageRequirement,
  extracted,
}) {
  const plan = extracted?.plan || '';
  const todo = extracted?.todo || '';
  const checkpoints = extracted?.checkpoints || '';
  const learnings = extracted?.learnings || '';

  let augmentedPrompt = task?.prompt || `## Cloud Task Context

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
${(taskComments || []).map(c => `${c.author}: ${c.content}`).join('\n')}
"""

## Extracted State

Goal: ${task.title || 'Untitled'}
Plan: ${plan || '(none)'}
Todo: ${todo || '(none)'}
Checkpoints: ${checkpoints || '(none)'}
Learnings: ${learnings || '(none)'}

`;

  if (!task?.prompt && task?.engine) {
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
${task?.content}
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
};


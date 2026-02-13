const path = require('path');
const { createCloudPromptHelpers } = require('../../../../lib/cli/cloud/prompts');

const helpers = createCloudPromptHelpers({
  path,
  truncateForPrompt: (text) => text,
  VERIFY_PROMPT_MAX_CHARS: 10000,
});

describe('buildVerifyPrompt', () => {
  it('explicitly calls out the target-state guidance before git diff output', () => {
    const prompt = helpers.buildVerifyPrompt({
      taskId: 'task-123',
      task: { stage: 'execution', title: 'Build feature', content: 'implement the feature' },
      stagePrompt: 'Ensure the new feature works end-to-end',
      stageRequirement: 'Stage complete when feature merged and tested',
      gitSummary: { status_porcelain: '', diff_stat: '' },
      verifyResults: [],
      iteration: 1,
      lastRunPath: '/tmp/agx/task-123/run-1',
      agentOutput: 'Agent already produced the patched files',
    });

    expect(prompt).toContain('Target state evidence:');
    expect(prompt).toMatch(/IMPORTANT: Before you look at the git status\/diff/);
  });
});

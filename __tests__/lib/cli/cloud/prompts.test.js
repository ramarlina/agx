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

    expect(prompt).toContain('Understand the request.');
    expect(prompt).toContain('Read the actual source files.');
  });

  it('prefers task.description over task.content in verify prompt request content', () => {
    const prompt = helpers.buildVerifyPrompt({
      taskId: 'task-456',
      task: {
        stage: 'execution',
        title: 'Use description',
        description: 'description-body-priority',
        content: 'legacy-content-should-not-win',
      },
      stagePrompt: 'Validate behavior',
      stageRequirement: 'Done when verified',
      gitSummary: { status_porcelain: '', diff_stat: '' },
      verifyResults: [],
      iteration: 1,
      lastRunPath: '/tmp/agx/task-456/run-1',
      agentOutput: '',
    });

    expect(prompt).toContain('description-body-priority');
    expect(prompt).not.toContain('legacy-content-should-not-win');
  });
});

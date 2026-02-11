const { buildFullDaemonPromptContext, extractSection } = require('../../lib/cli/cloudArtifacts');

describe('cloudArtifacts helpers', () => {
  test('extractSection returns section content for matching heading', () => {
    const content = [
      'Intro',
      '',
      '## Plan',
      '- step 1',
      '',
      '## Todo',
      '- next',
    ].join('\n');

    expect(extractSection(content, 'Plan')).toBe('- step 1');
    expect(extractSection(content, 'Todo')).toBe('- next');
  });

  test('buildFullDaemonPromptContext embeds extracted sections', () => {
    const content = [
      'Some intro',
      '',
      '## Plan',
      '- step 1',
      '',
      '## Todo',
      '- next',
      '',
      '## Checkpoints',
      '- c1',
      '',
      '## Learnings',
      '- l1',
    ].join('\n');

    const prompt = buildFullDaemonPromptContext({
      id: 'task-1',
      title: 'Title',
      stage: 'execute',
      content,
    }, {});

    expect(prompt).toContain('Plan: - step 1');
    expect(prompt).toContain('Todo: - next');
    expect(prompt).toContain('Checkpoints: - c1');
    expect(prompt).toContain('Learnings: - l1');
  });
});

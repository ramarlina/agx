const { buildCloudTaskPromptFromContext } = require('../../lib/prompts/cloudTask');

describe('cloud task prompt helpers', () => {
  test('buildCloudTaskPromptFromContext renders project context and filters execution comments', () => {
    const prompt = buildCloudTaskPromptFromContext({
      id: 'task-1',
      title: 'Task Title',
      slug: 'task-title',
      stage: 'execution',
      project: 'alpha',
      content: '---\nstatus: queued\n---\n# Task Title\n\nDo the thing.',
      comments: [
        {
          id: 'comment-1',
          task_id: 'task-1',
          author_type: 'user',
          content: 'User note',
          created_at: '2026-02-10T00:00:00.000Z',
        },
        {
          id: 'comment-2',
          task_id: 'task-1',
          author_type: 'agent',
          content: '[execution/decision]\ncommand: agx run',
          created_at: '2026-02-10T00:05:00.000Z',
        },
      ],
      learnings: {
        task: [{ content: 'Task insight' }],
        project: [{ content: 'Project insight' }],
        global: [{ content: 'Global insight' }],
      },
      project_context: {
        project: {
          id: 'proj-1',
          name: 'Alpha',
          slug: 'alpha',
          description: 'Alpha service',
          metadata: { stack: 'Next.js' },
          ci_cd_info: 'GitHub Actions',
          workflow_id: 'workflow-1',
        },
        repos: [
          {
            id: 'repo-1',
            project_id: 'proj-1',
            name: 'alpha-web',
            path: '/code/alpha-web',
            git_url: 'https://github.com/example/alpha-web',
            notes: 'Primary frontend',
          },
        ],
        learnings: ['Keep Feature Flag X disabled in prod'],
      },
      resolved_provider: 'claude',
      resolved_model: 'claude-3.5',
      resolved_swarm: false,
      resolved_swarm_models: [],
    });

    expect(prompt).toContain('PROJECT CONTEXT');
    expect(prompt).toContain('REPOSITORY MAP');
    expect(prompt).toContain('PROJECT LEARNINGS');
    expect(prompt).toContain('LEARNINGS (task)');
    expect(prompt).toContain('LEARNINGS (project)');
    expect(prompt).toContain('LEARNINGS (global)');
    expect(prompt).toContain('Alpha');
    expect(prompt).toContain('alpha-web');
    expect(prompt).toContain('Task insight');
    expect(prompt).toContain('Project insight');
    expect(prompt).toContain('Global insight');
    expect(prompt).toContain('User note');
    expect(prompt).not.toContain('[execution/decision]');
  });

  test('buildCloudTaskPromptFromContext prefers description over content body', () => {
    const prompt = buildCloudTaskPromptFromContext({
      id: 'task-2',
      title: 'Task Two',
      slug: 'task-two',
      stage: 'execution',
      project: 'alpha',
      description: 'description-priority-text',
      content: '---\nstatus: queued\n---\n# Task Two\n\nlegacy-content-text',
      comments: [],
      learnings: { task: [], project: [], global: [] },
      project_context: null,
      resolved_provider: 'claude',
      resolved_model: 'claude-3.5',
      resolved_swarm: false,
      resolved_swarm_models: [],
    });

    expect(prompt).toContain('description-priority-text');
    expect(prompt).not.toContain('legacy-content-text');
  });
});

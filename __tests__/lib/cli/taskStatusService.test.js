'use strict';

const {
  buildTaskStatusLines,
  fetchRecentTaskLogs,
} = require('../../../lib/cli/taskStatusService');

const colors = {
  bold: '',
  reset: '',
  dim: '',
  cyan: '',
  yellow: '',
};

describe('taskStatusService', () => {
  test('buildTaskStatusLines formats stage history and logs', () => {
    const task = {
      id: 'task-1',
      slug: 'task-slug',
      title: 'Task Title',
      description: 'Line 1\n\nLine 2',
      stage: 'execution',
      status: 'in_progress',
      updated_at: '2026-02-13T00:00:00.000Z',
      resolved_provider: 'claude',
      resolved_model: 'claude-3.5',
      project_context: { project: { name: 'Test Project', slug: 'test-project' } },
      run_index: [
        { created_at: '2026-02-12T03:00:00.000Z', stage: 'verification', status: 'pending', run_id: 'run-3' },
        { created_at: '2026-02-12T02:00:00.000Z', stage: 'execution', status: 'in_progress', run_id: 'run-2' },
      ],
    };
    const logs = [
      { created_at: '2026-02-12T05:00:00.000Z', log_type: 'output', content: 'First log entry' },
      { created_at: '2026-02-12T06:00:00.000Z', log_type: 'debug', content: 'Second log entry' },
    ];

    const lines = buildTaskStatusLines(task, logs, { colors, formatTimestamp: () => 'TS' });

    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Stage History:'),
      '  TS  execution (in_progress) Run run-2',
      '  TS  verification (pending) Run run-3',
      expect.stringContaining('Recent Logs:'),
      '  TS [output]',
      '  TS [debug]',
    ]));
  });

  test('buildTaskStatusLines handles missing description gracefully', () => {
    const task = {
      id: 'task-2',
      title: 'Untitled',
      description: '',
      stage: 'planning',
      status: 'queued',
      updated_at: null,
      run_index: [],
    };
    const lines = buildTaskStatusLines(task, [], { colors, formatTimestamp: () => 'TS' });
    expect(lines).toContain('Description: (none)');
    expect(lines).toContain('Stage History:');
    expect(lines).toContain('Recent Logs:');
  });

  test('fetchRecentTaskLogs returns logs when the API responds', async () => {
    const payload = { logs: [{ id: 'log-1' }] };
    const cloudRequest = jest.fn().mockResolvedValue(payload);
    const result = await fetchRecentTaskLogs({
      cloudRequest,
      taskId: 'task-unique',
      tail: 5,
      colors,
    });
    expect(cloudRequest).toHaveBeenCalledWith('GET', '/api/tasks/task-unique/logs?tail=5');
    expect(result).toEqual(payload.logs);
  });

  test('fetchRecentTaskLogs warns and returns empty list on failure', async () => {
    const cloudRequest = jest.fn().mockRejectedValue(new Error('boom'));
    const logger = { log: jest.fn() };
    const result = await fetchRecentTaskLogs({
      cloudRequest,
      taskId: 'task-fail',
      tail: 3,
      logger,
      colors,
    });
    expect(result).toEqual([]);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Could not fetch logs: boom'));
  });
});

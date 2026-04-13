/**
 * @jest-environment node
 */

const mockGetPromptJobStore = jest.fn();
const mockPollDueJobs = jest.fn();
const mockGetAgent = jest.fn();
const mockGetAgentSkills = jest.fn();
const mockGetProjectAgents = jest.fn();
const mockLoadDbParticipants = jest.fn();
const mockBuildCliAttempts = jest.fn();
const mockRunCliResponse = jest.fn();
const mockStartScriptedLinearSession = jest.fn();
const mockGetIssueActiveAgents = jest.fn();
const mockListObjectiveLinearIssues = jest.fn();
const mockLoadProjectObjectiveContext = jest.fn();
const mockPersistProjectObjectiveWorkspace = jest.fn();
const mockPersistProjectHealthSnapshot = jest.fn();
const mockActivityAppend = jest.fn();

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => mockGetPromptJobStore(),
}));

jest.mock('@/src/prompt-scheduler/engine', () => ({
  pollDueJobs: (...args: unknown[]) => mockPollDueJobs(...args),
}));

jest.mock('@/lib/db', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  getAgentSkills: (...args: unknown[]) => mockGetAgentSkills(...args),
  getProjectAgents: (...args: unknown[]) => mockGetProjectAgents(...args),
}));

jest.mock('@/lib/auth-mode', () => ({
  LOCAL_USER: { id: 'local-user-id' },
}));

jest.mock('@/lib/agent-participants', () => ({
  loadDbParticipants: (...args: unknown[]) => mockLoadDbParticipants(...args),
}));

jest.mock('@/lib/cli-runner', () => ({
  buildCliAttempts: (...args: unknown[]) => mockBuildCliAttempts(...args),
  runCliResponse: (...args: unknown[]) => mockRunCliResponse(...args),
}));

jest.mock('@/lib/linear-scripted-session', () => ({
  startScriptedLinearSession: (...args: unknown[]) => mockStartScriptedLinearSession(...args),
}));

jest.mock('@/lib/linear-run-store', () => ({
  getIssueActiveAgents: (...args: unknown[]) => mockGetIssueActiveAgents(...args),
}));

jest.mock('@/lib/objective-linear-issues', () => ({
  listObjectiveLinearIssues: (...args: unknown[]) => mockListObjectiveLinearIssues(...args),
  filterObjectiveLinearIssuesForAction: (
    issues: Array<{ id: string; status: string }>,
    blockedIssueIds: Iterable<string> = [],
  ) => {
    const blocked = new Set(Array.from(blockedIssueIds));
    return issues.filter((issue) => {
      const status = String(issue.status).trim().toLowerCase();
      return !['done', 'cancelled', 'canceled', 'duplicate'].includes(status) && !blocked.has(issue.id);
    });
  },
  isObjectiveLinearTerminalStatus: (status: string) =>
    ['done', 'cancelled', 'canceled', 'duplicate'].includes(String(status).trim().toLowerCase()),
}));

jest.mock('@/lib/project-objective-context', () => ({
  loadProjectObjectiveContext: (...args: unknown[]) => mockLoadProjectObjectiveContext(...args),
  persistProjectObjectiveWorkspace: (...args: unknown[]) => mockPersistProjectObjectiveWorkspace(...args),
  persistProjectHealthSnapshot: (...args: unknown[]) => mockPersistProjectHealthSnapshot(...args),
}));

jest.mock('@/src/objectives/activities/repository', () => ({
  getActivityRepository: () => ({
    append: (...args: unknown[]) => mockActivityAppend(...args),
  }),
}));

describe('prompt scheduler processor', () => {
  let store: Record<string, unknown>;
  const baseJob = {
    name: 'Inbox watcher',
    prompt: 'Summarize my unread emails',
    agentId: '',
    projectId: '',
    provider: 'claude',
    model: '',
    cliArgs: '',
    cronExpr: '*/5 * * * *',
    cadence: 'Every 5 minutes',
    state: 'active',
    overlapPolicy: 'skip',
    catchUpPolicy: 'fire_once',
    cancelCheckSec: 5,
    executionMode: 'prompt',
    condition: '',
    nextRunAt: Date.now() + 300000,
    lastRunAt: null,
    lastOutcome: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([]),
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockPollDueJobs.mockResolvedValue({ queued: [], skipped: [] });
    mockGetAgent.mockResolvedValue(null);
    mockGetAgentSkills.mockResolvedValue([]);
    mockGetProjectAgents.mockResolvedValue([]);
    mockLoadDbParticipants.mockResolvedValue([]);
    mockBuildCliAttempts.mockReturnValue([]);
    mockRunCliResponse.mockResolvedValue(undefined);
    mockStartScriptedLinearSession.mockResolvedValue({
      run: { id: 'linear-run-1' },
      chatRunId: 'chat-run-1',
      userMessageId: 'message-1',
    });
    mockGetIssueActiveAgents.mockResolvedValue([]);
    mockListObjectiveLinearIssues.mockResolvedValue({ issues: [], refreshedAt: null });
    mockLoadProjectObjectiveContext.mockResolvedValue(null);
    mockPersistProjectObjectiveWorkspace.mockResolvedValue({});
    mockPersistProjectHealthSnapshot.mockResolvedValue({});
  });

  test('processPromptJobs redrives existing queued runs', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      ...baseJob,
      id: 'job-queued',
    };
    const orphanedRun = { id: 'run-queued', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([orphanedRun]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('Recovered run');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    const result = await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.dispatched).toBe(1);
    expect(mockRunCliResponse).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(
      orphanedRun.id,
      expect.objectContaining({ status: 'running' }),
    );
    expect(updateJob).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ lastOutcome: 'success' }),
    );
  });

  test('condition-gated runs skip the action when the gate fails', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      ...baseJob,
      id: 'job-gated',
      condition: 'there are unread emails',
    };
    const run = { id: 'run-gated', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([run]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('no');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRunCliResponse).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        status: 'success',
        output: expect.stringContaining('condition not met'),
      }),
    );
  });

  test('objective Linear worker records a no-op activity when the controller stops', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      ...baseJob,
      id: 'job-objective-stop',
      prompt: 'Pick the best ticket to work if one is ready.',
      projectId: 'project-1',
      objectiveId: 'objective-1',
      objectiveKey: 'growth-daily-visitors',
      executionMode: 'objective_linear_ticket',
    };
    const run = { id: 'run-objective-stop', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([run]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockLoadDbParticipants.mockResolvedValue([
      { id: 'agent-1', name: 'Growth Agent', provider: 'claude', model: null, color: '#000000' },
    ]);
    mockGetProjectAgents.mockResolvedValue([
      { project_id: 'project-1', agent_id: 'agent-1', routing_order: 0 },
    ]);
    mockGetAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Growth Agent',
      provider: 'claude',
      model: null,
      description: 'Helps with growth work.',
      voice: '',
    });
    mockLoadProjectObjectiveContext.mockResolvedValue({
      project: { id: 'project-1', slug: 'alpha', metadata: { existing: true } },
      workspace: {
        objectives: [
          {
            id: 'objective-1',
            title: 'Grow daily visitors',
            key: 'growth-daily-visitors',
            summary: 'Increase daily visitors through acquisition work.',
            progress: 15,
            status: 'at_risk',
          },
        ],
      },
      objective: {
        id: 'objective-1',
        title: 'Grow daily visitors',
        key: 'growth-daily-visitors',
        summary: 'Increase daily visitors through acquisition work.',
        progress: 15,
        status: 'at_risk',
      },
    });
    mockListObjectiveLinearIssues.mockResolvedValue({
      issues: [
        {
          id: 'issue-1',
          identifier: 'ESO-1',
          title: 'Refresh landing copy',
          status: 'Backlog',
          assignee: null,
          updatedAt: '2026-04-12T10:00:00.000Z',
          url: 'https://linear.app/example/issue/ESO-1',
          labels: ['growth-daily-visitors'],
        },
      ],
      refreshedAt: '2026-04-12T10:05:00.000Z',
    });
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('{"action":"stop","reason":"Nothing is ready for implementation yet.","objectiveProgress":21,"objectiveStatus":"at_risk","projectProgress":34,"projectStatus":"at_risk","objectiveNote":"Progress is improving but still early.","projectNote":"The project still depends heavily on this acquisition stream."}');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockStartScriptedLinearSession).not.toHaveBeenCalled();
    expect(mockPersistProjectObjectiveWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      workspace: expect.objectContaining({
        objectives: expect.arrayContaining([
          expect.objectContaining({
            id: 'objective-1',
            progress: 21,
            status: 'at_risk',
          }),
        ]),
      }),
    }));
    expect(mockActivityAppend).toHaveBeenCalledWith(expect.objectContaining({
      source: 'scheduled-task:job-objective-stop',
      body: expect.stringContaining('No action taken'),
    }));
    expect(updateJob).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ lastOutcome: 'success' }),
    );
  });

  test('objective Linear worker launches one scripted session for the selected ticket', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      ...baseJob,
      id: 'job-objective-work',
      prompt: 'Start the single best next objective ticket.',
      projectId: 'project-1',
      objectiveId: 'objective-1',
      objectiveKey: 'growth-daily-visitors',
      executionMode: 'objective_linear_ticket',
    };
    const run = { id: 'run-objective-work', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([run]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockLoadDbParticipants.mockResolvedValue([
      { id: 'agent-1', name: 'Growth Agent', provider: 'claude', model: null, color: '#000000' },
    ]);
    mockGetProjectAgents.mockResolvedValue([
      { project_id: 'project-1', agent_id: 'agent-1', routing_order: 0 },
    ]);
    mockGetAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Growth Agent',
      provider: 'claude',
      model: null,
      description: 'Helps with growth work.',
      voice: '',
    });
    mockLoadProjectObjectiveContext.mockResolvedValue({
      project: { id: 'project-1', slug: 'alpha', metadata: { existing: true } },
      workspace: {
        objectives: [
          {
            id: 'objective-1',
            title: 'Grow daily visitors',
            key: 'growth-daily-visitors',
            summary: 'Increase daily visitors through acquisition work.',
            progress: 20,
            status: 'at_risk',
          },
          {
            id: 'objective-2',
            title: 'Improve retention',
            key: 'retain-users',
            summary: 'Reduce churn.',
            progress: 45,
            status: 'on_track',
          },
        ],
      },
      objective: {
        id: 'objective-1',
        title: 'Grow daily visitors',
        key: 'growth-daily-visitors',
        summary: 'Increase daily visitors through acquisition work.',
        progress: 20,
        status: 'at_risk',
      },
    });
    mockListObjectiveLinearIssues.mockResolvedValue({
      issues: [
        {
          id: 'issue-1',
          identifier: 'ESO-1',
          title: 'Refresh landing copy',
          status: 'Backlog',
          assignee: null,
          updatedAt: '2026-04-12T10:00:00.000Z',
          url: 'https://linear.app/example/issue/ESO-1',
          labels: ['growth-daily-visitors'],
        },
        {
          id: 'issue-2',
          identifier: 'ESO-2',
          title: 'Write CTA experiment brief',
          status: 'Done',
          assignee: null,
          updatedAt: '2026-04-12T10:00:00.000Z',
          url: 'https://linear.app/example/issue/ESO-2',
          labels: ['growth-daily-visitors'],
        },
      ],
      refreshedAt: '2026-04-12T10:05:00.000Z',
    });
    mockRunCliResponse.mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
      onDelta?.('{"action":"work_ticket","ticketId":"issue-1","reason":"This is the clearest next step.","objectiveProgress":44,"objectiveStatus":"at_risk","projectProgress":51,"projectStatus":"on_track"}');
    });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockStartScriptedLinearSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      projectSlug: 'alpha',
      agentId: 'agent-1',
      issue: expect.objectContaining({
        id: 'issue-1',
        identifier: 'ESO-1',
      }),
    }));
    expect(mockPersistProjectObjectiveWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      workspace: expect.objectContaining({
        objectives: expect.arrayContaining([
          expect.objectContaining({
            id: 'objective-1',
            progress: 44,
            status: 'at_risk',
          }),
        ]),
      }),
    }));
    expect(mockActivityAppend).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Started work on [ESO-1]'),
    }));
    expect(updateJob).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ lastOutcome: 'success' }),
    );
  });

  test('objective worker executes run_prompt action from controller', async () => {
    const updateRun = jest.fn();
    const updateJob = jest.fn();
    const job = {
      ...baseJob,
      id: 'job-objective-prompt',
      prompt: 'Decide what to do next for this objective.',
      projectId: 'project-1',
      objectiveId: 'objective-1',
      objectiveKey: 'growth-daily-visitors',
      executionMode: 'objective_linear_ticket',
    };
    const run = { id: 'run-objective-prompt', jobId: job.id, status: 'queued' };
    store = {
      listQueuedRuns: jest.fn().mockReturnValue([run]),
      getJob: jest.fn().mockReturnValue(job),
      updateRun,
      updateJob,
    };
    mockGetPromptJobStore.mockReturnValue(store);
    mockLoadDbParticipants.mockResolvedValue([
      { id: 'agent-1', name: 'Growth Agent', provider: 'claude', model: null, color: '#000000' },
    ]);
    mockGetProjectAgents.mockResolvedValue([
      { project_id: 'project-1', agent_id: 'agent-1', routing_order: 0 },
    ]);
    mockGetAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Growth Agent',
      provider: 'claude',
      model: null,
      description: 'Helps with growth work.',
      voice: '',
    });
    mockLoadProjectObjectiveContext.mockResolvedValue({
      project: { id: 'project-1', slug: 'alpha', metadata: {} },
      workspace: {
        objectives: [
          {
            id: 'objective-1',
            title: 'Grow daily visitors',
            key: 'growth-daily-visitors',
            summary: 'Increase daily visitors.',
            progress: 10,
            status: 'at_risk',
          },
        ],
      },
      objective: {
        id: 'objective-1',
        title: 'Grow daily visitors',
        key: 'growth-daily-visitors',
        summary: 'Increase daily visitors.',
        progress: 10,
        status: 'at_risk',
      },
    });
    mockListObjectiveLinearIssues.mockResolvedValue({ issues: [], refreshedAt: null });

    // First call: controller returns run_prompt action
    // Second call: agent executes the prompt
    mockRunCliResponse
      .mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
        onDelta?.('{"action":"run_prompt","prompt":"Create a Linear ticket for SEO audit of landing pages.","reason":"No tickets exist yet, need to create initial work items.","objectiveProgress":10,"objectiveStatus":"at_risk"}');
      })
      .mockImplementationOnce(async ({ onDelta }: { onDelta?: (chunk: string) => void }) => {
        onDelta?.('Created ticket ESO-5: SEO audit of landing pages');
      });

    const { processPromptJobs } = await import('@/src/prompt-scheduler/processor');
    await processPromptJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockStartScriptedLinearSession).not.toHaveBeenCalled();
    expect(mockRunCliResponse).toHaveBeenCalledTimes(2);
    // Verify the second call received the controller's prompt
    expect(mockRunCliResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Create a Linear ticket for SEO audit'),
      }),
    );
    expect(mockActivityAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Created ticket ESO-5'),
      }),
    );
  });

  test('requestPromptJobPump schedules pending work once a pump registers', async () => {
    jest.useFakeTimers();

    const { registerPromptJobPump, requestPromptJobPump } = await import('@/src/prompt-scheduler/processor');
    const pump = jest.fn().mockResolvedValue(undefined);

    expect(requestPromptJobPump()).toBe(false);
    registerPromptJobPump(pump);

    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(pump).toHaveBeenCalledTimes(1);
  });

  test('logActionReceipt writes formatted activity for objective-linked receipts', async () => {
    mockLoadProjectObjectiveContext.mockResolvedValue({
      project: { id: 'project-1', slug: 'alpha', metadata: {} },
      workspace: { objectives: [] },
      objective: {
        id: 'objective-1',
        title: 'Grow daily visitors',
        key: 'growth-daily-visitors',
        summary: '',
        progress: 20,
        status: 'on_track',
      },
    });

    const { logActionReceipt } = await import('@/src/prompt-scheduler/processor');
    await logActionReceipt(
      {
        action: 'run_prompt',
        jobName: 'Draft design doc',
        reason: 'No tickets ready, drafting spec instead',
        result: 'Created design doc at docs/spec.md',
        durationMs: 5000,
        status: 'success',
      },
      {
        jobId: 'job-1',
        projectId: 'project-1',
        objectiveId: 'objective-1',
      },
    );

    expect(mockActivityAppend).toHaveBeenCalledTimes(1);
    expect(mockActivityAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'scheduled-task:job-1',
        type: 'status-update',
        body: expect.stringContaining('Draft design doc'),
      }),
    );
    expect(mockActivityAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Created design doc at docs/spec.md'),
      }),
    );
  });

  test('logActionReceipt is a no-op when objective context cannot be loaded', async () => {
    mockLoadProjectObjectiveContext.mockResolvedValue(null);

    const { logActionReceipt } = await import('@/src/prompt-scheduler/processor');
    await logActionReceipt(
      {
        action: 'stop',
        jobName: 'Some worker',
        reason: 'Nothing to do',
        result: 'Skipped',
        durationMs: 100,
        status: 'success',
      },
      {
        jobId: 'job-1',
        projectId: 'project-1',
        objectiveId: 'objective-1',
      },
    );

    expect(mockActivityAppend).not.toHaveBeenCalled();
  });
});

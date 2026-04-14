/**
 * @jest-environment node
 */

const mockRunCliResponse = jest.fn();
const mockBuildCliAttempts = jest.fn();
const mockListObjectiveLinearIssues = jest.fn();
const mockGetIssueActiveAgents = jest.fn();
const mockLoadProjectObjectiveContext = jest.fn();
const mockPersistProjectObjectiveWorkspace = jest.fn();
const mockPersistProjectHealthSnapshot = jest.fn();
const mockActivityList = jest.fn();
const mockActivityAppend = jest.fn();
const mockNoteReadAll = jest.fn();
const mockLogActionReceipt = jest.fn();
const mockDispatchObjectiveAction = jest.fn();
const mockListJobs = jest.fn();

jest.mock('@/lib/cli-runner', () => ({
  buildCliAttempts: (...args: unknown[]) => mockBuildCliAttempts(...args),
  runCliResponse: (...args: unknown[]) => mockRunCliResponse(...args),
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

jest.mock('@/lib/linear-run-store', () => ({
  getIssueActiveAgents: (...args: unknown[]) => mockGetIssueActiveAgents(...args),
}));

jest.mock('@/lib/project-objective-context', () => ({
  loadProjectObjectiveContext: (...args: unknown[]) => mockLoadProjectObjectiveContext(...args),
  persistProjectObjectiveWorkspace: (...args: unknown[]) => mockPersistProjectObjectiveWorkspace(...args),
  persistProjectHealthSnapshot: (...args: unknown[]) => mockPersistProjectHealthSnapshot(...args),
}));

jest.mock('@/lib/project-objectives', () => ({
  normalizeProjectHealthProgress: (v: number) => Math.min(100, Math.max(0, Math.round(v))),
  normalizeProjectHealthStatus: (v: string) => {
    const valid = ['on_track', 'at_risk', 'off_track', 'done'];
    return valid.includes(v) ? v : null;
  },
  upsertProjectObjective: jest.fn().mockImplementation((workspace, objective) => ({
    ...workspace,
    objectives: workspace.objectives.map((o: { id: string }) =>
      o.id === objective.id ? objective : o,
    ),
  })),
  writeProjectHealthSnapshot: jest.fn().mockImplementation((metadata) => metadata),
}));

jest.mock('@/src/objectives/activities/repository', () => ({
  getActivityRepository: () => ({
    list: (...args: unknown[]) => mockActivityList(...args),
    append: (...args: unknown[]) => mockActivityAppend(...args),
  }),
}));

jest.mock('@/src/objectives/notes', () => ({
  getNoteRepository: () => ({
    readAll: (...args: unknown[]) => mockNoteReadAll(...args),
  }),
}));

jest.mock('@/src/prompt-scheduler/get-store', () => ({
  getPromptJobStore: () => ({
    listJobs: (...args: unknown[]) => mockListJobs(...args),
  }),
}));

jest.mock('@/src/prompt-scheduler/processor', () => ({
  logActionReceipt: (...args: unknown[]) => mockLogActionReceipt(...args),
  dispatchObjectiveAction: (...args: unknown[]) => mockDispatchObjectiveAction(...args),
}));

import { buildObjectiveObservation, executeObjectiveWorker } from '@/src/prompt-scheduler/objective-worker';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseJob = {
  id: 'job-1',
  name: 'Objective Worker',
  prompt: 'Review tickets and advance the objective.',
  agentId: 'agent-1',
  projectId: 'project-1',
  objectiveId: 'objective-1',
  objectiveKey: 'obj-key',
  provider: 'claude',
  model: '',
  cliArgs: '',
  cronExpr: '*/5 * * * *',
  cadence: 'Every 5 minutes',
  state: 'active' as const,
  overlapPolicy: 'skip' as const,
  catchUpPolicy: 'fire_once' as const,
  cancelCheckSec: 5,
  executionMode: 'objective_worker' as const,
  condition: '',
  nextRunAt: null,
  lastRunAt: null,
  lastOutcome: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

const objectiveContext = {
  project: {
    id: 'project-1',
    slug: 'my-project',
    metadata: {},
  },
  workspace: {
    objectives: [
      {
        id: 'objective-1',
        title: 'Ship v2 API',
        key: 'ship-v2-api',
        summary: 'Build and ship the v2 REST API.',
        progress: 40,
        status: 'on_track' as const,
        teamId: 'team-1',
        threadId: null,
        chatSessionVersion: 0,
        scheduledTaskIds: [],
        cadence: '',
        condition: '',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'objective-2',
        title: 'Improve CI pipeline',
        key: 'improve-ci',
        summary: 'Speed up CI/CD.',
        progress: 60,
        status: 'on_track' as const,
        teamId: 'team-1',
        threadId: null,
        chatSessionVersion: 0,
        scheduledTaskIds: [],
        cadence: '',
        condition: '',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ],
    activities: [],
    activityThreads: {},
  },
  objective: {
    id: 'objective-1',
    title: 'Ship v2 API',
    key: 'ship-v2-api',
    summary: 'Build and ship the v2 REST API.',
    progress: 40,
    status: 'on_track' as const,
    teamId: 'team-1',
    threadId: null,
    chatSessionVersion: 0,
    scheduledTaskIds: [],
    cadence: '',
    condition: '',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
};

const sampleIssues = [
  {
    id: 'issue-1',
    identifier: 'ENG-1',
    title: 'Implement auth endpoint',
    url: 'https://linear.app/team/ENG-1',
    status: 'In Progress',
    assignee: 'Alice',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'issue-2',
    identifier: 'ENG-2',
    title: 'Write API tests',
    url: 'https://linear.app/team/ENG-2',
    status: 'Todo',
    assignee: null,
    updatedAt: '2026-04-09T00:00:00.000Z',
  },
  {
    id: 'issue-3',
    identifier: 'ENG-3',
    title: 'Deploy to staging',
    url: null,
    status: 'Done',
    assignee: 'Bob',
    updatedAt: '2026-04-08T00:00:00.000Z',
  },
];

const controllerContext = {
  provider: 'claude' as const,
  model: null,
  identity: undefined,
  self: undefined,
  skills: undefined,
};

const sessionAgent = {
  id: 'agent-1',
  name: 'Worker',
  provider: 'claude',
} as any;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Default mocks
  mockListObjectiveLinearIssues.mockResolvedValue({ issues: sampleIssues });
  mockGetIssueActiveAgents.mockResolvedValue([]);
  mockActivityList.mockReturnValue({
    activities: [
      {
        id: 'act-1',
        source: 'scheduled-task:job-1',
        objectiveLabel: 'ship-v2-api',
        createdAt: '2026-04-13T10:00:00.000Z',
        type: 'status-update',
        body: 'Started work on ENG-1\nMore details here',
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    hasMore: false,
  });
  mockNoteReadAll.mockReturnValue([
    {
      id: 'note-1',
      title: 'Architecture decision',
      objectiveId: 'objective-1',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      body: 'We chose REST over GraphQL for v2.',
    },
  ]);
  mockListJobs.mockReturnValue([
    baseJob,
    {
      ...baseJob,
      id: 'job-2',
      name: 'Nightly check',
      state: 'active',
      lastOutcome: 'success',
    },
  ]);
  mockLoadProjectObjectiveContext.mockResolvedValue(objectiveContext);
  mockPersistProjectObjectiveWorkspace.mockResolvedValue(undefined);
  mockPersistProjectHealthSnapshot.mockResolvedValue(undefined);
  mockLogActionReceipt.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests: buildObjectiveObservation
// ---------------------------------------------------------------------------

describe('buildObjectiveObservation', () => {
  it('assembles all sections correctly', async () => {
    const result = await buildObjectiveObservation({
      job: baseJob as any,
      objectiveContext: objectiveContext as any,
    });

    const prompt = result.prompt;

    // GOAL section
    expect(prompt).toContain('GOAL\nShip v2 API');
    expect(prompt).toContain('Build and ship the v2 REST API.');

    // CURRENT STATE
    expect(prompt).toContain('Progress: 40% | Status: on_track');

    // NOTES
    expect(prompt).toContain('NOTES');
    expect(prompt).toContain('### Architecture decision');
    expect(prompt).toContain('We chose REST over GraphQL for v2.');

    // RECENT ACTIVITY
    expect(prompt).toContain('RECENT ACTIVITY');
    expect(prompt).toContain('[2026-04-13 10:00] Started work on ENG-1');

    // LINEAR TICKETS
    expect(prompt).toContain('LINEAR TICKETS');
    expect(prompt).toContain('identifier: ENG-1');
    expect(prompt).toContain('identifier: ENG-2');
    expect(prompt).toContain('identifier: ENG-3');

    // SCHEDULED TASKS (sibling only — job-2)
    expect(prompt).toContain('SCHEDULED TASKS');
    expect(prompt).toContain('Nightly check | state: active | last outcome: success');

    // PROJECT CONTEXT (sibling objective)
    expect(prompt).toContain('PROJECT CONTEXT');
    expect(prompt).toContain('Improve CI pipeline (improve-ci) | 60% | on_track');

    // GUIDANCE
    expect(prompt).toContain('GUIDANCE');
    expect(prompt).toContain('Review tickets and advance the objective.');

    // ELIGIBLE TICKETS (issues 1 & 2, not 3 which is Done)
    expect(prompt).toContain('ELIGIBLE TICKETS');

    // Final question
    expect(prompt).toContain('What single action most advances this objective right now?');

    // Structured data
    expect(result.issues).toHaveLength(3);
    expect(result.eligibleIssues).toHaveLength(2);
    expect(result.activeIssueAgents).toEqual([]);
  });

  it('includes active sessions when agents are running', async () => {
    mockGetIssueActiveAgents.mockResolvedValue([
      { issueId: 'issue-1', agentId: 'agent-2', agentName: 'Helper' },
    ]);

    const result = await buildObjectiveObservation({
      job: baseJob as any,
      objectiveContext: objectiveContext as any,
    });

    expect(result.prompt).toContain('ACTIVE SESSIONS');
    expect(result.prompt).toContain('issue-1: running with Helper');
    // issue-1 is now blocked so only issue-2 is eligible
    expect(result.eligibleIssues).toHaveLength(1);
    expect(result.eligibleIssues[0].id).toBe('issue-2');
  });

  it('handles empty data gracefully', async () => {
    mockListObjectiveLinearIssues.mockResolvedValue({ issues: [] });
    mockActivityList.mockReturnValue({ activities: [], total: 0, page: 1, limit: 20, hasMore: false });
    mockNoteReadAll.mockReturnValue([]);
    mockListJobs.mockReturnValue([baseJob]); // only self — no siblings

    const result = await buildObjectiveObservation({
      job: baseJob as any,
      objectiveContext: {
        ...objectiveContext,
        workspace: {
          ...objectiveContext.workspace,
          objectives: [objectiveContext.objective],
        },
      } as any,
    });

    const prompt = result.prompt;

    // Should still have core sections
    expect(prompt).toContain('GOAL');
    expect(prompt).toContain('CURRENT STATE');
    expect(prompt).toContain('LINEAR TICKETS\n- None.');
    expect(prompt).toContain('ELIGIBLE TICKETS\n- None.');
    // Should NOT have optional sections
    expect(prompt).not.toContain('NOTES');
    expect(prompt).not.toContain('RECENT ACTIVITY');
    expect(prompt).not.toContain('ACTIVE SESSIONS');
    expect(prompt).not.toContain('SCHEDULED TASKS');
    expect(prompt).not.toContain('PROJECT CONTEXT');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeObjectiveWorker
// ---------------------------------------------------------------------------

describe('executeObjectiveWorker', () => {
  it('handles stop action', async () => {
    const stopReceipt = {
      action: 'stop',
      jobName: 'Objective Worker',
      reason: 'No urgent work right now.',
      result: 'No action taken.\n\nReason: No urgent work right now.',
      durationMs: 100,
      status: 'success' as const,
    };
    mockDispatchObjectiveAction.mockResolvedValue(stopReceipt);

    mockRunCliResponse.mockImplementation(async (opts: any) => {
      opts.onDelta(JSON.stringify({
        action: 'stop',
        reason: 'No urgent work right now.',
        objectiveProgress: 40,
        objectiveStatus: 'on_track',
      }));
    });

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('success');
    expect(result.output).toContain('No action taken');
    expect(mockDispatchObjectiveAction).toHaveBeenCalledTimes(1);
    expect(mockLogActionReceipt).toHaveBeenCalledTimes(1);
    expect(mockLogActionReceipt).toHaveBeenCalledWith(stopReceipt, {
      jobId: 'job-1',
      projectId: 'project-1',
      objectiveId: 'objective-1',
    });
  });

  it('handles work_ticket action', async () => {
    const workReceipt = {
      action: 'work_ticket',
      jobName: 'Objective Worker',
      reason: 'Auth endpoint is the next priority.',
      result: 'Started work on ENG-1: Implement auth endpoint',
      linearRunId: 'run-123',
      durationMs: 200,
      status: 'success' as const,
    };
    mockDispatchObjectiveAction.mockResolvedValue(workReceipt);

    mockRunCliResponse.mockImplementation(async (opts: any) => {
      opts.onDelta(JSON.stringify({
        action: 'work_ticket',
        ticketId: 'issue-1',
        reason: 'Auth endpoint is the next priority.',
        objectiveProgress: 45,
        objectiveStatus: 'on_track',
      }));
    });

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('success');
    expect(result.output).toContain('Started work on ENG-1');
    expect(mockDispatchObjectiveAction).toHaveBeenCalledTimes(1);

    const dispatchCall = mockDispatchObjectiveAction.mock.calls[0][0];
    expect(dispatchCall.action).toBe('work_ticket');
    expect(dispatchCall.reason).toBe('Auth endpoint is the next priority.');
    expect(mockLogActionReceipt).toHaveBeenCalledTimes(1);
  });

  it('handles run_prompt action', async () => {
    const promptReceipt = {
      action: 'run_prompt',
      jobName: 'Objective Worker',
      reason: 'Need to create tickets for v2 migration.',
      result: 'Prompt completed.',
      durationMs: 300,
      status: 'success' as const,
    };
    mockDispatchObjectiveAction.mockResolvedValue(promptReceipt);

    mockRunCliResponse.mockImplementation(async (opts: any) => {
      opts.onDelta(JSON.stringify({
        action: 'run_prompt',
        prompt: 'Create Linear tickets for the v2 migration plan.',
        reason: 'Need to create tickets for v2 migration.',
        objectiveProgress: 42,
        objectiveStatus: 'on_track',
      }));
    });

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('success');
    expect(result.output).toContain('Prompt completed');
    expect(mockDispatchObjectiveAction).toHaveBeenCalledTimes(1);

    const dispatchCall = mockDispatchObjectiveAction.mock.calls[0][0];
    expect(dispatchCall.action).toBe('run_prompt');
    expect(mockLogActionReceipt).toHaveBeenCalledTimes(1);
  });

  it('returns failure when objective context is missing', async () => {
    mockLoadProjectObjectiveContext.mockResolvedValue(null);

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Objective context could not be resolved');
  });

  it('returns failure when projectId is missing', async () => {
    const result = await executeObjectiveWorker({
      job: { ...baseJob, projectId: '' } as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('require projectId and objectiveId');
  });

  it('handles controller LLM failure', async () => {
    mockRunCliResponse.mockRejectedValue(new Error('LLM timeout'));

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('LLM timeout');
  });

  it('applies health side-effects when objective progress changes', async () => {
    mockDispatchObjectiveAction.mockResolvedValue({
      action: 'stop',
      jobName: 'Objective Worker',
      reason: 'Done for now.',
      result: 'No action taken.',
      durationMs: 100,
      status: 'success',
    });

    mockRunCliResponse.mockImplementation(async (opts: any) => {
      opts.onDelta(JSON.stringify({
        action: 'stop',
        reason: 'Done for now.',
        objectiveProgress: 60,
        objectiveStatus: 'at_risk',
        projectProgress: 50,
        projectStatus: 'on_track',
      }));
    });

    await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    // Objective changed from 40/on_track to 60/at_risk so workspace should be persisted
    expect(mockPersistProjectObjectiveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('handles legacy "decision" field', async () => {
    mockDispatchObjectiveAction.mockResolvedValue({
      action: 'stop',
      jobName: 'Objective Worker',
      reason: 'Legacy stop.',
      result: 'No action taken.',
      durationMs: 100,
      status: 'success',
    });

    mockRunCliResponse.mockImplementation(async (opts: any) => {
      opts.onDelta(JSON.stringify({
        decision: 'stop',
        reason: 'Legacy stop.',
        objectiveProgress: 40,
        objectiveStatus: 'on_track',
      }));
    });

    const result = await executeObjectiveWorker({
      job: baseJob as any,
      controllerContext,
      sessionAgent,
    });

    expect(result.status).toBe('success');
    const dispatchCall = mockDispatchObjectiveAction.mock.calls[0][0];
    expect(dispatchCall.action).toBe('stop');
  });
});

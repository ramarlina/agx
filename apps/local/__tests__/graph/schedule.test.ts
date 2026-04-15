import {
  scheduleTickIfDue,
  completeScheduleTick,
  isScheduleTickComplete,
  createThreadMonitorSchedule,
  activateSchedule,
  stopSchedule,
} from '../../src/graph/schedule';
import type { ExecutionGraph, GraphSchedule } from '../../src/graph/types';

function makeMinimalGraph(schedule?: GraphSchedule): ExecutionGraph {
  return {
    id: 'g1',
    taskId: 't1',
    graphVersion: 1,
    mode: 'SIMPLE',
    nodes: {
      root: { type: 'root', status: 'done', deps: [], title: 'Root', objective: 'test', graphCreated: true },
      'pull-status': {
        type: 'function',
        status: 'done',
        deps: ['root'],
        kind: 'bash',
        title: 'Pull status',
        command: 'curl http://localhost/api/history/status?format=compact&rootMessageId=abc',
        metrics: { tokensUsed: 12, latencyMs: 25, retryCount: 1 },
        output: { activeProcessCount: 0 },
      },
      'idle-check': {
        type: 'conditional',
        status: 'done',
        deps: ['pull-status'],
        metrics: { tokensUsed: 1, latencyMs: 5, retryCount: 0 },
        condition: { expression: 'input.activeProcessCount == 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
        evaluatedTo: 'then',
      },
      'verify-and-route': {
        type: 'work',
        status: 'done',
        deps: ['idle-check'],
        title: 'Verify and route',
        attempts: 1,
        maxAttempts: 3,
        retryPolicy: { backoffMs: 0, onExhaust: 'fail' },
      },
    },
    edges: [
      { from: 'root', to: 'pull-status', type: 'hard' },
      { from: 'pull-status', to: 'idle-check', type: 'hard', dataMapping: [{ sourceField: 'output', targetField: 'input' }] },
      { from: 'idle-check', to: 'verify-and-route', type: 'hard', condition: 'on_success' },
    ],
    policy: {
      replanBudgetRemaining: 3,
      replanBudgetInitial: 3,
      verifyBudgetRemaining: 5,
      verifyBudgetInitial: 5,
      maxConcurrentAutoChecks: 2,
      immutableRequiredGates: false,
      maxConcurrent: 2,
      priorityMode: 'fifo',
      nodeTimeoutMs: 30000,
      graphTimeoutMs: 600000,
    },
    doneCriteria: { allRequiredGatesPassed: false, noRunnableOrPendingWork: true },
    schedule,
    versionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('graph schedule', () => {
  describe('scheduleTickIfDue', () => {
    it('returns no_schedule when graph has no schedule', () => {
      const graph = makeMinimalGraph();
      const result = scheduleTickIfDue(graph, Date.now());
      expect(result.tickFired).toBe(false);
      expect(result.skipReason).toBe('no_schedule');
    });

    it('returns not_active when schedule is stopped', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);
      schedule.state = 'stopped';
      const graph = makeMinimalGraph(schedule);
      const result = scheduleTickIfDue(graph, Date.now());
      expect(result.tickFired).toBe(false);
      expect(result.skipReason).toBe('not_active');
    });

    it('returns max_concurrency_reached when at capacity', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);
      schedule.tickInProgress = true;
      schedule.currentConcurrency = 5;
      schedule.maxConcurrency = 5;
      const graph = makeMinimalGraph(schedule);
      const result = scheduleTickIfDue(graph, Date.now() + 120000);
      expect(result.tickFired).toBe(false);
      expect(result.skipReason).toBe('max_concurrency_reached');
    });

    it('returns max_runs_reached when maxRuns exhausted', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000, 5);
      schedule.runCount = 5;
      const graph = makeMinimalGraph(schedule);
      const result = scheduleTickIfDue(graph, Date.now() + 120000);
      expect(result.tickFired).toBe(false);
      expect(result.skipReason).toBe('max_runs_reached');
    });

    it('returns not_due when interval has not elapsed', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);
      schedule.lastTickAt = 1000;
      const graph = makeMinimalGraph(schedule);
      const result = scheduleTickIfDue(graph, 30000); // only 29s elapsed
      expect(result.tickFired).toBe(false);
      expect(result.skipReason).toBe('not_due');
    });

    it('fires tick and resets nodes when due', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);
      schedule.lastTickAt = 0;
      const graph = makeMinimalGraph(schedule);
      const now = 120000;
      const result = scheduleTickIfDue(graph, now);

      expect(result.tickFired).toBe(true);
      expect(result.resetNodeIds).toContain('pull-status');
      expect(result.resetNodeIds).toContain('idle-check');

      // Nodes should be reset to pending
      expect(result.graph.nodes['pull-status'].status).toBe('pending');
      expect(result.graph.nodes['idle-check'].status).toBe('pending');

      // Function node output should be cleared
      const fn = result.graph.nodes['pull-status'];
      expect(fn.type === 'function' && fn.output).toBeUndefined();
      expect(fn.metrics).toBeUndefined();

      // Conditional evaluatedTo should be cleared
      const cond = result.graph.nodes['idle-check'];
      expect(cond.type === 'conditional' && cond.evaluatedTo).toBeUndefined();
      expect(cond.metrics).toBeUndefined();

      // Schedule metadata updated
      expect(result.graph.schedule!.tickInProgress).toBe(true);
      expect(result.graph.schedule!.currentConcurrency).toBe(1);
      expect(result.graph.schedule!.lastTickAt).toBe(now);
      expect(result.graph.schedule!.runCount).toBe(1);
    });

    it('does not reset nodes that are still pending', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      const graph = makeMinimalGraph(schedule);
      graph.nodes['pull-status'] = { ...graph.nodes['pull-status'], status: 'pending' } as any;
      const result = scheduleTickIfDue(graph, Date.now() + 120000);
      expect(result.tickFired).toBe(true);
      expect(result.resetNodeIds).not.toContain('pull-status');
    });
  });

  describe('completeScheduleTick', () => {
    it('decrements currentConcurrency and clears tickInProgress when reaching zero', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      schedule.tickInProgress = true;
      schedule.currentConcurrency = 1;
      const graph = makeMinimalGraph(schedule);
      const result = completeScheduleTick(graph);
      expect(result.schedule!.tickInProgress).toBe(false);
      expect(result.schedule!.currentConcurrency).toBe(0);
    });

    it('keeps tickInProgress true when other ticks still running', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      schedule.tickInProgress = true;
      schedule.currentConcurrency = 3;
      const graph = makeMinimalGraph(schedule);
      const result = completeScheduleTick(graph);
      expect(result.schedule!.tickInProgress).toBe(true);
      expect(result.schedule!.currentConcurrency).toBe(2);
    });

    it('is no-op when no schedule', () => {
      const graph = makeMinimalGraph();
      const result = completeScheduleTick(graph);
      expect(result).toBe(graph);
    });
  });

  describe('isScheduleTickComplete', () => {
    it('returns true when all reset nodes are terminal', () => {
      const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);
      const graph = makeMinimalGraph(schedule);
      // Both nodes are 'done' in the fixture
      expect(isScheduleTickComplete(graph)).toBe(true);
    });

    it('returns false when a reset node is still running', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      const graph = makeMinimalGraph(schedule);
      graph.nodes['pull-status'] = { ...graph.nodes['pull-status'], status: 'running' } as any;
      expect(isScheduleTickComplete(graph)).toBe(false);
    });
  });

  describe('activateSchedule', () => {
    it('is idempotent for active schedule', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      const graph = makeMinimalGraph(schedule);
      const result = activateSchedule(graph);
      expect(result).toBe(graph); // same reference, no mutation
    });

    it('reactivates a stopped schedule', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      schedule.state = 'stopped';
      const graph = makeMinimalGraph(schedule);
      const result = activateSchedule(graph);
      expect(result.schedule!.state).toBe('active');
    });
  });

  describe('stopSchedule', () => {
    it('stops an active schedule and resets concurrency', () => {
      const schedule = createThreadMonitorSchedule(['pull-status'], 60000);
      schedule.tickInProgress = true;
      schedule.currentConcurrency = 3;
      const graph = makeMinimalGraph(schedule);
      const result = stopSchedule(graph);
      expect(result.schedule!.state).toBe('stopped');
      expect(result.schedule!.tickInProgress).toBe(false);
      expect(result.schedule!.currentConcurrency).toBe(0);
    });
  });
});

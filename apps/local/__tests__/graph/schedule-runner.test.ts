/**
 * @jest-environment node
 */

import { scheduleTickIfDue, completeScheduleTick, createThreadMonitorSchedule } from '@/src/graph/schedule';
import { schedulerTick } from '@/src/graph/scheduler';
import { executeNode } from '@/src/graph/executor';
import { createDispatchFunction } from '@/src/graph/function-executor';
import type { ExecutionGraph, FunctionNode, ConditionalNode, WorkNode } from '@/src/graph/types';
import { DEFAULT_EXECUTION_POLICY } from '@/src/graph/constants';

function makeThreadMonitorGraph(scheduleActive = true): ExecutionGraph {
  const schedule = createThreadMonitorSchedule(['pull-status', 'idle-check'], 60000);

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
        command: "printf '{\"activeProcessCount\":0}'",
        output: { activeProcessCount: 0 },
      },
      'idle-check': {
        type: 'conditional',
        status: 'done',
        deps: ['pull-status'],
        condition: { expression: 'input.activeProcessCount === 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
        evaluatedTo: 'then',
      },
      'verify-and-route': {
        type: 'work',
        status: 'pending',
        deps: ['idle-check'],
        title: 'Verify and route',
        attempts: 0,
        maxAttempts: 3,
        retryPolicy: { backoffMs: 0, onExhaust: 'fail' },
      },
    },
    edges: [
      { from: 'root', to: 'pull-status', type: 'hard' },
      { from: 'pull-status', to: 'idle-check', type: 'hard' },
      { from: 'idle-check', to: 'verify-and-route', type: 'hard', condition: 'on_success' },
    ],
    policy: DEFAULT_EXECUTION_POLICY,
    doneCriteria: { allRequiredGatesPassed: false, noRunnableOrPendingWork: true },
    schedule: scheduleActive ? schedule : { ...schedule, state: 'stopped' },
    versionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('schedule-runner integration', () => {
  describe('scheduleTickIfDue with function nodes', () => {
    test('resets function node output when resetting to pending', () => {
      const graph = makeThreadMonitorGraph(true);
      graph.schedule!.lastTickAt = 0; // Force tick to be due

      const result = scheduleTickIfDue(graph, Date.now() + 120000);

      expect(result.tickFired).toBe(true);
      expect(result.graph.nodes['pull-status'].status).toBe('pending');

      // Function node output should be cleared
      const fn = result.graph.nodes['pull-status'];
      if (fn.type === 'function') {
        expect(fn.output).toBeUndefined();
      }
    });

    test('clears conditional evaluatedTo when resetting', () => {
      const graph = makeThreadMonitorGraph(true);
      graph.schedule!.lastTickAt = 0;

      const result = scheduleTickIfDue(graph, Date.now() + 120000);

      expect(result.tickFired).toBe(true);
      const cond = result.graph.nodes['idle-check'];
      if (cond.type === 'conditional') {
        expect(cond.evaluatedTo).toBeUndefined();
      }
    });
  });

  describe('end-to-end tick execution', () => {
    test('function node executes and produces output for conditional', async () => {
      // Start with a fresh graph where pull-status is pending
      const graph = makeThreadMonitorGraph(false); // No schedule for this test
      graph.nodes['pull-status'] = {
        type: 'function',
        status: 'pending',
        deps: ['root'],
        kind: 'bash',
        title: 'Pull status',
        command: "printf '{\"activeProcessCount\":0,\"messageCount\":3}'",
      };
      graph.nodes['idle-check'] = {
        type: 'conditional',
        status: 'pending',
        deps: ['pull-status'],
        condition: { expression: 'input.activeProcessCount === 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
      };

      const dispatchFunction = createDispatchFunction();

      // Execute the function node
      const result = await executeNode(graph, 'pull-status', { dispatchFunction });
      const fn = result.graph.nodes['pull-status'];

      expect(fn.type).toBe('function');
      if (fn.type === 'function') {
        expect(fn.status).toBe('done');
        expect(fn.output).toEqual({ activeProcessCount: 0, messageCount: 3 });
      }

      // Now run scheduler tick to evaluate the conditional
      const schedulerResult = schedulerTick(result.graph);
      const cond = schedulerResult.graph.nodes['idle-check'];

      expect(cond.type).toBe('conditional');
      if (cond.type === 'conditional') {
        expect(cond.status).toBe('done');
        expect(cond.evaluatedTo).toBe('then'); // Should take thenBranch since activeProcessCount is 0
      }

      // Verify work node is now runnable
      expect(schedulerResult.workToRun).toContain('verify-and-route');
    });

    test('conditional evaluates to else when processes are active', async () => {
      const graph = makeThreadMonitorGraph(false);
      graph.nodes['pull-status'] = {
        type: 'function',
        status: 'pending',
        deps: ['root'],
        kind: 'bash',
        title: 'Pull status',
        command: "printf '{\"activeProcessCount\":2}'", // Active processes!
      };
      graph.nodes['idle-check'] = {
        type: 'conditional',
        status: 'pending',
        deps: ['pull-status'],
        condition: { expression: 'input.activeProcessCount === 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
      };

      const dispatchFunction = createDispatchFunction();

      // Execute the function node
      const result = await executeNode(graph, 'pull-status', { dispatchFunction });

      // Run scheduler tick
      const schedulerResult = schedulerTick(result.graph);
      const cond = schedulerResult.graph.nodes['idle-check'];

      expect(cond.type).toBe('conditional');
      if (cond.type === 'conditional') {
        expect(cond.status).toBe('done');
        expect(cond.evaluatedTo).toBe('else'); // Should take elseBranch since activeProcessCount is 2
      }

      // Work node should be skipped
      const work = schedulerResult.graph.nodes['verify-and-route'];
      expect(work.status).toBe('skipped');
    });

    test('conditional evaluates to else when function node fails (with always edge)', async () => {
      const graph = makeThreadMonitorGraph(false);
      // Use 'always' edge condition so conditional is evaluated even when upstream fails
      graph.edges[1] = { from: 'pull-status', to: 'idle-check', type: 'hard', condition: 'always' };
      graph.nodes['pull-status'] = {
        type: 'function',
        status: 'pending',
        deps: ['root'],
        kind: 'bash',
        title: 'Pull status',
        command: "exit 1", // Fail!
      };
      graph.nodes['idle-check'] = {
        type: 'conditional',
        status: 'pending',
        deps: ['pull-status'],
        condition: { expression: 'input.activeProcessCount === 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
      };

      const dispatchFunction = createDispatchFunction();

      // Execute the function node (will fail)
      const result = await executeNode(graph, 'pull-status', { dispatchFunction });
      const fn = result.graph.nodes['pull-status'];

      expect(fn.type).toBe('function');
      if (fn.type === 'function') {
        expect(fn.status).toBe('failed');
      }

      // Run scheduler tick
      const schedulerResult = schedulerTick(result.graph);
      const cond = schedulerResult.graph.nodes['idle-check'];

      // Fail-safe: conditional should evaluate to else when upstream fails
      expect(cond.type).toBe('conditional');
      if (cond.type === 'conditional') {
        expect(cond.status).toBe('done');
        expect(cond.evaluatedTo).toBe('else');
      }

      // Work node should be skipped
      const work = schedulerResult.graph.nodes['verify-and-route'];
      expect(work.status).toBe('skipped');
    });

    test('conditional evaluates to else when function output is null', async () => {
      const graph = makeThreadMonitorGraph(false);
      // Function node that returns empty stdout (no output)
      graph.nodes['pull-status'] = {
        type: 'function',
        status: 'done',
        deps: ['root'],
        kind: 'bash',
        title: 'Pull status',
        command: "printf ''",
        output: undefined, // No output
      };
      graph.nodes['idle-check'] = {
        type: 'conditional',
        status: 'pending',
        deps: ['pull-status'],
        condition: { expression: 'input.activeProcessCount === 0', inputFrom: 'pull-status' },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
      };

      // Run scheduler tick
      const schedulerResult = schedulerTick(graph);
      const cond = schedulerResult.graph.nodes['idle-check'];

      // Fail-safe: conditional should evaluate to else when upstream has no output
      expect(cond.type).toBe('conditional');
      if (cond.type === 'conditional') {
        expect(cond.status).toBe('done');
        expect(cond.evaluatedTo).toBe('else');
      }
    });
  });
});
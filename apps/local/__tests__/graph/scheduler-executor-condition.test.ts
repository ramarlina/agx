/**
 * @jest-environment node
 */

import { DEFAULT_EXECUTION_POLICY } from '@/src/graph/constants';
import { evaluateCondition, ConditionEvaluationError } from '@/src/graph/condition';
import {
  executeNode,
  GraphExecutionTimeoutError,
  type WorkDispatchResult,
} from '@/src/graph/executor';
import {
  activateGraphSchedule,
  finalizeScheduledTick,
  isDepSatisfied,
  isExecutionComplete,
  prepareScheduledTick,
  prioritizeNodeIds,
  schedulerTick,
} from '@/src/graph/scheduler';
import type {
  Edge,
  ExecutionGraph,
  FunctionNode,
  GateNode,
  GraphNode,
  WorkNode,
} from '@/src/graph/types';

function makeWorkNode(overrides: Partial<WorkNode> = {}): WorkNode {
  return {
    type: 'work',
    status: 'pending',
    deps: [],
    title: 'work',
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: {
      backoffMs: 100,
      onExhaust: 'fail',
    },
    ...overrides,
  };
}

function makeGateNode(overrides: Partial<GateNode> = {}): GateNode {
  return {
    type: 'gate',
    status: 'pending',
    deps: [],
    gateType: 'quality_gate',
    required: true,
    verificationStrategy: {
      type: 'auto',
      checks: ['tests_pass'],
    },
    ...overrides,
  };
}

function makeFunctionNode(overrides: Partial<FunctionNode> = {}): FunctionNode {
  return {
    type: 'function',
    status: 'pending',
    deps: [],
    kind: 'bash',
    title: 'function',
    command: 'printf \'{}\'',
    ...overrides,
  };
}

function makeGraph(
  nodes: Record<string, GraphNode>,
  edges: Edge[] = [],
  overrides: Partial<ExecutionGraph> = {},
): ExecutionGraph {
  return {
    id: 'graph-1',
    taskId: 'task-1',
    graphVersion: 1,
    mode: 'PROJECT',
    nodes,
    edges,
    policy: {
      ...DEFAULT_EXECUTION_POLICY,
      maxConcurrent: 3,
      maxConcurrentAutoChecks: 2,
      priorityMode: 'fifo',
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: [],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('condition evaluator', () => {
  test('evaluates CEL expression to boolean', () => {
    expect(evaluateCondition('x > 1 && y == "ok"', { x: 2, y: 'ok' })).toBe(true);
  });

  test('throws on invalid expression', () => {
    expect(() => evaluateCondition('x >', { x: 1 })).toThrow(ConditionEvaluationError);
  });

  test('throws when expression does not return boolean', () => {
    expect(() => evaluateCondition('1 + 2', {})).toThrow(ConditionEvaluationError);
  });
});

describe('scheduler dependency semantics', () => {
  test('isDepSatisfied handles hard/soft edge conditions', () => {
    const graph = makeGraph(
      {
        depSuccess: makeWorkNode({ status: 'done' }),
        depFailure: makeWorkNode({ status: 'failed' }),
        depBlocked: makeWorkNode({ status: 'blocked' }),
        target: makeWorkNode({ deps: ['depSuccess', 'depFailure', 'depBlocked'] }),
      },
      [
        { from: 'depSuccess', to: 'target', type: 'hard', condition: 'on_success' },
        { from: 'depFailure', to: 'target', type: 'hard', condition: 'on_failure' },
        { from: 'depBlocked', to: 'target', type: 'soft' },
      ],
    );

    expect(isDepSatisfied(graph, 'depSuccess', 'target')).toBe(true);
    expect(isDepSatisfied(graph, 'depFailure', 'target')).toBe(true);
    expect(isDepSatisfied(graph, 'depBlocked', 'target')).toBe(true);
  });

  test('hard always condition waits for terminal status', () => {
    const graph = makeGraph(
      {
        dep: makeWorkNode({ status: 'running' }),
        target: makeWorkNode({ deps: ['dep'] }),
      },
      [{ from: 'dep', to: 'target', type: 'hard', condition: 'always' }],
    );

    expect(isDepSatisfied(graph, 'dep', 'target')).toBe(false);
    graph.nodes.dep = makeWorkNode({ status: 'failed' });
    expect(isDepSatisfied(graph, 'dep', 'target')).toBe(true);
  });
});

describe('scheduler concurrency and priority', () => {
  test('enforces work and auto-check concurrency, human gates are lightweight', () => {
    const graph = makeGraph(
      {
        'work-running': makeWorkNode({ status: 'running' }),
        'work-a': makeWorkNode(),
        'work-b': makeWorkNode(),
        'gate-human': makeGateNode({
          verificationStrategy: { type: 'human' },
          required: false,
        }),
        'gate-auto-running': makeGateNode({ status: 'running', required: false }),
        'gate-auto-a': makeGateNode({ required: false }),
        'gate-hybrid-b': makeGateNode({
          required: false,
          verificationStrategy: { type: 'hybrid', checks: ['tests_pass'] },
        }),
      },
      [],
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          maxConcurrent: 2,
          maxConcurrentAutoChecks: 2,
          priorityMode: 'fifo',
        },
      },
    );

    const tick = schedulerTick(graph);
    expect(tick.lightweightGatesToRun).toEqual(['gate-human']);
    expect(tick.autoGatesToRun).toEqual(['gate-auto-a']);
    expect(tick.workToRun).toEqual(['work-a']);
    expect(tick.dispatchOrder).toEqual(['gate-human', 'gate-auto-a', 'work-a']);
  });

  test('supports fifo, shortest_first, and critical_path priority modes', () => {
    const fifoGraph = makeGraph({
      'work-b': makeWorkNode({ estimateMinutes: 20 }),
      'work-a': makeWorkNode({ estimateMinutes: 5 }),
    });
    expect(prioritizeNodeIds(fifoGraph, ['work-b', 'work-a'])).toEqual(['work-b', 'work-a']);

    const shortestGraph = makeGraph(
      {
        slow: makeWorkNode({ estimateMinutes: 30 }),
        fast: makeWorkNode({ estimateMinutes: 5 }),
        medium: makeWorkNode({ estimateMinutes: 10 }),
      },
      [],
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          priorityMode: 'shortest_first',
        },
      },
    );
    expect(prioritizeNodeIds(shortestGraph, ['slow', 'fast', 'medium'])).toEqual([
      'fast',
      'medium',
      'slow',
    ]);

    const criticalGraph = makeGraph(
      {
        shortRoot: makeWorkNode({ estimateMinutes: 5 }),
        shortLeaf: makeWorkNode({ deps: ['shortRoot'], estimateMinutes: 5 }),
        longRoot: makeWorkNode({ estimateMinutes: 5 }),
        longMid: makeWorkNode({ deps: ['longRoot'], estimateMinutes: 15 }),
        longLeaf: makeWorkNode({ deps: ['longMid'], estimateMinutes: 20 }),
      },
      [
        { from: 'shortRoot', to: 'shortLeaf', type: 'hard' },
        { from: 'longRoot', to: 'longMid', type: 'hard' },
        { from: 'longMid', to: 'longLeaf', type: 'hard' },
      ],
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          priorityMode: 'critical_path',
        },
      },
    );
    expect(prioritizeNodeIds(criticalGraph, ['shortRoot', 'longRoot'])).toEqual([
      'longRoot',
      'shortRoot',
    ]);
  });
});

describe('scheduler completion detection and conditional handling', () => {
  test('isExecutionComplete respects required gates, incomplete statuses, sinks, and custom criteria', () => {
    const graph = makeGraph(
      {
        work: makeWorkNode({ status: 'done' }),
        gate: makeGateNode({
          status: 'passed',
          deps: ['work'],
          required: true,
        }),
      },
      [{ from: 'work', to: 'gate', type: 'hard' }],
      {
        doneCriteria: {
          allRequiredGatesPassed: true,
          noRunnableOrPendingWork: true,
          completionSinkNodeIds: ['gate'],
          customCriteria: ['1 == 1'],
        },
      },
    );

    expect(isExecutionComplete(graph)).toBe(true);

    graph.nodes.gate = makeGateNode({ status: 'failed', required: true, deps: ['work'] });
    expect(isExecutionComplete(graph)).toBe(false);

    graph.nodes.gate = makeGateNode({ status: 'passed', required: true, deps: ['work'] });
    graph.nodes.work = makeWorkNode({ status: 'running' });
    expect(isExecutionComplete(graph)).toBe(false);
  });

  test('conditional CEL errors mark conditional node failed', () => {
    const graph = makeGraph(
      {
        source: makeWorkNode({ status: 'done', output: { flag: true } }),
        cond: {
          type: 'conditional',
          status: 'pending',
          deps: ['source'],
          condition: {
            expression: 'ctx.input.flag == ',
            inputFrom: 'source',
          },
          thenBranch: ['then-work'],
          elseBranch: ['else-work'],
        },
        'then-work': makeWorkNode({ deps: ['cond'] }),
        'else-work': makeWorkNode({ deps: ['cond'] }),
      },
      [
        { from: 'source', to: 'cond', type: 'hard' },
        { from: 'cond', to: 'then-work', type: 'hard' },
        { from: 'cond', to: 'else-work', type: 'hard' },
      ],
    );

    const tick = schedulerTick(graph);
    expect(tick.graph.nodes.cond.status).toBe('failed');
  });

  test('conditional resolves inputFrom to function output', () => {
    const graph = makeGraph(
      {
        'pull-status': makeFunctionNode({
          status: 'done',
          output: { activeProcessCount: 0 },
        }),
        'idle-check': {
          type: 'conditional',
          status: 'pending',
          deps: ['pull-status'],
          condition: {
            expression: 'input.activeProcessCount == 0',
            inputFrom: 'pull-status',
          },
          thenBranch: ['verify-and-route'],
          elseBranch: ['noop'],
        },
        'verify-and-route': makeWorkNode({ deps: ['idle-check'] }),
        noop: makeWorkNode({ deps: ['idle-check'] }),
      },
      [
        { from: 'pull-status', to: 'idle-check', type: 'hard' },
        { from: 'idle-check', to: 'verify-and-route', type: 'hard' },
        { from: 'idle-check', to: 'noop', type: 'hard' },
      ],
    );

    const tick = schedulerTick(graph);
    const conditional = tick.graph.nodes['idle-check'];
    expect(conditional.type).toBe('conditional');
    if (conditional.type === 'conditional') {
      expect(conditional.status).toBe('done');
      expect(conditional.evaluatedTo).toBe('then');
    }
    expect(tick.graph.nodes['verify-and-route'].status).toBe('pending');
    expect(tick.graph.nodes.noop.status).toBe('skipped');
  });

  test('missing function output short-circuits conditional to else branch', () => {
    const graph = makeGraph(
      {
        'pull-status': makeFunctionNode({ status: 'done' }),
        'idle-check': {
          type: 'conditional',
          status: 'pending',
          deps: ['pull-status'],
          condition: {
            expression: 'input.activeProcessCount == 0',
            inputFrom: 'pull-status',
          },
          thenBranch: ['verify-and-route'],
          elseBranch: ['noop'],
        },
        'verify-and-route': makeWorkNode({ deps: ['idle-check'] }),
        noop: makeWorkNode({ deps: ['idle-check'] }),
      },
      [
        { from: 'pull-status', to: 'idle-check', type: 'hard' },
        { from: 'idle-check', to: 'verify-and-route', type: 'hard' },
        { from: 'idle-check', to: 'noop', type: 'hard' },
      ],
    );

    const tick = schedulerTick(graph);
    const conditional = tick.graph.nodes['idle-check'];
    expect(conditional.type).toBe('conditional');
    if (conditional.type === 'conditional') {
      expect(conditional.status).toBe('done');
      expect(conditional.evaluatedTo).toBe('else');
    }
    expect(tick.graph.nodes['verify-and-route'].status).toBe('skipped');
    expect(tick.graph.nodes.noop.status).toBe('pending');
  });
});

describe('scheduled recurrence guardrails', () => {
  test('schedule activation is idempotent and overlapping ticks are skipped', () => {
    const base = makeGraph({
      'pull-status': makeFunctionNode({ status: 'done', output: { activeProcessCount: 1 } }),
      'idle-check': {
        type: 'conditional',
        status: 'done',
        deps: ['pull-status'],
        condition: {
          expression: 'input.activeProcessCount == 0',
          inputFrom: 'pull-status',
        },
        thenBranch: ['verify-and-route'],
        elseBranch: [],
        evaluatedTo: 'else',
      },
      'verify-and-route': makeWorkNode({ deps: ['idle-check'], status: 'done' }),
    });

    const scheduled = activateGraphSchedule(base, {
      intervalMs: 60_000,
      resetNodeIds: ['pull-status', 'idle-check'],
      rootMessageId: 'root-1',
    });
    const activatedAgain = activateGraphSchedule(scheduled, {
      intervalMs: 60_000,
      resetNodeIds: ['pull-status', 'idle-check'],
      rootMessageId: 'root-1',
    });

    expect(activatedAgain).toEqual(scheduled);

    const prepared = prepareScheduledTick(activatedAgain, 60_000);
    expect(prepared.shouldRun).toBe(true);
    expect(prepared.graph.schedule?.tickInProgress).toBe(true);
    expect(prepared.graph.schedule?.currentConcurrency).toBe(1);
    expect(prepared.graph.nodes['pull-status'].status).toBe('pending');
    expect(prepared.graph.nodes['idle-check'].status).toBe('pending');

    // With default maxConcurrency=5, a second tick is allowed
    const overlapping = prepareScheduledTick(prepared.graph, 120_000);
    expect(overlapping.shouldRun).toBe(true);
    expect(overlapping.graph.schedule?.currentConcurrency).toBe(2);

    // But at capacity, further ticks are blocked
    const atCapacity = { ...prepared.graph };
    atCapacity.schedule = { ...atCapacity.schedule!, currentConcurrency: 5, maxConcurrency: 5 };
    const blocked = prepareScheduledTick(atCapacity, 120_000);
    expect(blocked.shouldRun).toBe(false);
    expect(blocked.skipReason).toBe('overlap');

    const finalized = finalizeScheduledTick(prepared.graph, 120_000);
    expect(finalized.schedule?.tickInProgress).toBe(false);
    expect(finalized.schedule?.currentConcurrency).toBe(0);
    expect(finalized.schedule?.runCount).toBe(1);
  });
});

describe('executor retry/exhaust and timeouts', () => {
  test('retries work node with backoff when attempts remain', async () => {
    const graph = makeGraph({
      work: makeWorkNode({
        retryPolicy: { backoffMs: 42, onExhaust: 'fail' },
        maxAttempts: 3,
      }),
    });
    const sleep = jest.fn(async () => undefined);

    const result = await executeNode(graph, 'work', {
      dispatchWork: async () =>
        ({
          status: 'failure',
          transient: true,
          message: 'temporary',
        }) as WorkDispatchResult,
      sleep,
    });

    const node = result.graph.nodes.work;
    expect(node.type).toBe('work');
    if (node.type === 'work') {
      expect(node.attempts).toBe(1);
      expect(node.status).toBe('pending');
    }
    expect(sleep).toHaveBeenCalledWith(42);
  });

  test('applies onExhaust policy (skip / escalate)', async () => {
    const skipGraph = makeGraph({
      work: makeWorkNode({
        maxAttempts: 1,
        retryPolicy: { backoffMs: 1, onExhaust: 'skip' },
      }),
    });

    const skipped = await executeNode(skipGraph, 'work', {
      dispatchWork: async () => ({ status: 'failure', transient: true }),
    });
    expect(skipped.graph.nodes.work.status).toBe('skipped');

    const onEscalate = jest.fn(async () => undefined);
    const escalateGraph = makeGraph({
      work: makeWorkNode({
        maxAttempts: 1,
        retryPolicy: { backoffMs: 1, onExhaust: 'escalate' },
      }),
    });
    const escalated = await executeNode(escalateGraph, 'work', {
      dispatchWork: async () => ({ status: 'failure', transient: true }),
      onEscalateWorkFailure: onEscalate,
    });
    expect(escalated.graph.nodes.work.status).toBe('blocked');
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  test('enforces node timeout and graph timeout', async () => {
    const nodeTimeoutGraph = makeGraph(
      {
        work: makeWorkNode({
          maxAttempts: 2,
          retryPolicy: { backoffMs: 1, onExhaust: 'fail' },
        }),
      },
      [],
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          nodeTimeoutMs: 5,
        },
      },
    );
    const sleep = jest.fn(async () => undefined);
    const timedOut = await executeNode(nodeTimeoutGraph, 'work', {
      dispatchWork: async () =>
        new Promise<WorkDispatchResult>((resolve) => {
          setTimeout(() => resolve({ status: 'success' }), 30);
        }),
      sleep,
    });
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.graph.nodes.work.status).toBe('pending');

    const graphTimeoutGraph = makeGraph(
      {
        work: makeWorkNode(),
      },
      [],
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          graphTimeoutMs: 1,
        },
      },
    );

    await expect(
      executeNode(graphTimeoutGraph, 'work', {
        nowMs: () => Date.parse('2026-02-14T00:00:00.100Z'),
        graphStartedAtMs: Date.parse('2026-02-14T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(GraphExecutionTimeoutError);
  });

  test('executes bash function nodes and stores parsed stdout JSON in output', async () => {
    const graph = makeGraph({
      fn: makeFunctionNode({
        command: 'printf \'{"activeProcessCount":0,"messageCount":12}\'',
      }),
    });

    const result = await executeNode(graph, 'fn');
    const node = result.graph.nodes.fn;
    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('done');
      expect(node.output).toEqual({ activeProcessCount: 0, messageCount: 12 });
    }
  });

  test('fails function nodes when stdout is not valid JSON', async () => {
    const graph = makeGraph({
      fn: makeFunctionNode({
        command: "printf 'not-json'",
      }),
    });

    const result = await executeNode(graph, 'fn');
    const node = result.graph.nodes.fn;
    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('failed');
      expect(node.metrics?.errorMessages?.join(' ')).toContain('not valid JSON');
    }
  });

  test('bounds function stdout size to protect the tick loop', async () => {
    const graph = makeGraph({
      fn: makeFunctionNode({
        command: "head -c 70000 < /dev/zero | tr '\\0' 'a'",
      }),
    });

    const result = await executeNode(graph, 'fn');
    const node = result.graph.nodes.fn;
    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('failed');
      expect(node.metrics?.errorMessages?.join(' ')).toContain('exceeded');
    }
  });
});

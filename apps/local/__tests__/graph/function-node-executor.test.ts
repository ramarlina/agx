/**
 * @jest-environment node
 */

import { DEFAULT_EXECUTION_POLICY } from '@/src/graph/constants';
import { executeNode } from '@/src/graph/executor';
import type { ExecutionGraph, FunctionNode, GraphNode } from '@/src/graph/types';

function makeFunctionNode(overrides: Partial<FunctionNode> = {}): FunctionNode {
  return {
    type: 'function',
    status: 'pending',
    deps: [],
    kind: 'bash',
    title: 'pull-status',
    command: "printf '{\"activeProcessCount\":0}'",
    timeoutMs: 1_000,
    ...overrides,
  };
}

function makeGraph(nodes: Record<string, GraphNode>): ExecutionGraph {
  return {
    id: 'graph-function-1',
    taskId: 'task-function-1',
    graphVersion: 1,
    mode: 'SIMPLE',
    nodes,
    edges: [],
    policy: {
      ...DEFAULT_EXECUTION_POLICY,
      nodeTimeoutMs: 1_000,
      graphTimeoutMs: 30_000,
    },
    doneCriteria: {
      allRequiredGatesPassed: false,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: [],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('function node executor (bash)', () => {
  test('parses stdout JSON into node.output', async () => {
    const graph = makeGraph({
      'pull-status': makeFunctionNode({
        command: "printf '{\"activeProcessCount\":0,\"messageCount\":3}'",
      }),
    });

    const result = await executeNode(graph, 'pull-status');
    const node = result.graph.nodes['pull-status'];

    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('done');
      expect(node.output).toEqual({
        activeProcessCount: 0,
        messageCount: 3,
      });
    }
  });

  test('fails when stdout is not valid JSON', async () => {
    const graph = makeGraph({
      'pull-status': makeFunctionNode({
        command: "printf 'not-json'",
      }),
    });

    const result = await executeNode(graph, 'pull-status');
    const node = result.graph.nodes['pull-status'];

    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('failed');
      expect(node.metrics?.errorMessages?.join('\n') ?? '').toContain('stdout is not valid JSON');
    }
  });

  test('fails when stdout exceeds bounded buffer', async () => {
    const graph = makeGraph({
      'pull-status': makeFunctionNode({
        command: "node -e \"process.stdout.write('a'.repeat(70000))\"",
      }),
    });

    const result = await executeNode(graph, 'pull-status');
    const node = result.graph.nodes['pull-status'];

    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('failed');
      expect(node.metrics?.errorMessages?.join('\n') ?? '').toContain('Function stdout exceeded');
    }
  });

  test('enforces timeout so stalled commands fail fast', async () => {
    const graph = makeGraph({
      'pull-status': makeFunctionNode({
        timeoutMs: 20,
        command: "node -e \"setTimeout(() => process.stdout.write('{\\\"ok\\\":true}'), 200)\"",
      }),
    });

    const result = await executeNode(graph, 'pull-status');
    const node = result.graph.nodes['pull-status'];

    expect(node.type).toBe('function');
    if (node.type === 'function') {
      expect(node.status).toBe('failed');
      expect(node.metrics?.errorMessages?.join('\n') ?? '').toContain('timeout');
    }
    expect(result.timedOut).toBe(true);
  });
});

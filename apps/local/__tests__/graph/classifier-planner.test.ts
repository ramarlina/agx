/**
 * @jest-environment node
 */

import {
  classify,
  extractClassificationSignals,
  type ClassificationSignals,
} from '@/src/graph/classifier';
import {
  buildProjectGraph,
  buildSimpleGraph,
  generateInitialGraph,
} from '@/src/graph/planner';
import type { ExecutionGraph, GateNode, GraphNode } from '@/src/graph/types';

const BASE_SIMPLE_SIGNALS: ClassificationSignals = {
  estimatedMinutes: 29,
  hasExternalDeps: false,
  hasParallelWork: false,
  requiresVerification: false,
  fileCount: 1,
  componentCount: 1,
  hasMultiplePhases: false,
  keywords: [],
};

const CHECKPOINT_GATE_TYPES = new Set<GateNode['gateType']>([
  'progress',
  'quality_gate',
  'design_gate',
  'handoff_gate',
]);

function isCheckpointNode(node: GraphNode): boolean {
  return node.type === 'gate' && CHECKPOINT_GATE_TYPES.has(node.gateType);
}

function buildAdjacency(graph: ExecutionGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const existing = adjacency.get(edge.from) ?? [];
    existing.push(edge.to);
    adjacency.set(edge.from, existing);
  }

  return adjacency;
}

function assertDag(graph: ExecutionGraph): void {
  const adjacency = buildAdjacency(graph);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      throw new Error(`Cycle detected at node: ${nodeId}`);
    }
    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      visit(next);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of Object.keys(graph.nodes)) {
    visit(nodeId);
  }
}

function assertDepsAndEdgesConsistency(graph: ExecutionGraph): void {
  const nodeIds = new Set(Object.keys(graph.nodes));

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    for (const dep of node.deps) {
      expect(nodeIds.has(dep)).toBe(true);
      expect(graph.edges.some((edge) => edge.from === dep && edge.to === nodeId)).toBe(true);
    }
  }

  for (const edge of graph.edges) {
    expect(nodeIds.has(edge.from)).toBe(true);
    expect(nodeIds.has(edge.to)).toBe(true);
    expect(graph.nodes[edge.to].deps).toContain(edge.from);
  }
}

function assertStructuralValidity(graph: ExecutionGraph): void {
  assertDag(graph);
  assertDepsAndEdgesConsistency(graph);

  const completionSinkNodeIds = graph.doneCriteria.completionSinkNodeIds ?? [];
  for (const sinkNodeId of completionSinkNodeIds) {
    expect(graph.nodes[sinkNodeId]).toBeDefined();
  }
}

function completionSinks(graph: ExecutionGraph): string[] {
  if (graph.doneCriteria.completionSinkNodeIds?.length) {
    return graph.doneCriteria.completionSinkNodeIds;
  }

  const outgoingHardEdges = new Set(
    graph.edges.filter((edge) => edge.type === 'hard').map((edge) => edge.from),
  );

  return Object.keys(graph.nodes).filter((nodeId) => !outgoingHardEdges.has(nodeId));
}

function enumeratePaths(graph: ExecutionGraph): string[][] {
  const sinks = new Set(completionSinks(graph));
  const starts = Object.entries(graph.nodes)
    .filter(([, node]) => node.deps.length === 0)
    .map(([nodeId]) => nodeId);
  const adjacency = buildAdjacency(graph);
  const paths: string[][] = [];

  const visit = (nodeId: string, path: string[], seen: Set<string>): void => {
    const nextPath = [...path, nodeId];

    if (sinks.has(nodeId)) {
      paths.push(nextPath);
      return;
    }

    for (const next of adjacency.get(nodeId) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      const nextSeen = new Set(seen);
      nextSeen.add(next);
      visit(next, nextPath, nextSeen);
    }
  };

  for (const startNodeId of starts) {
    visit(startNodeId, [], new Set([startNodeId]));
  }

  return paths;
}

function assertCheckpointOnEachCompletionPath(graph: ExecutionGraph): void {
  const paths = enumeratePaths(graph);
  expect(paths.length).toBeGreaterThan(0);

  for (const path of paths) {
    const hasCheckpoint = path.some((nodeId) => isCheckpointNode(graph.nodes[nodeId]));
    expect(hasCheckpoint).toBe(true);
  }
}

function runOptionalValidateGraph(graph: ExecutionGraph): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const maybeValidateModule = require('@/src/graph/validate');
    const validateGraph = maybeValidateModule?.validateGraph as
      | undefined
      | ((targetGraph: ExecutionGraph) => boolean | { valid: boolean });

    if (typeof validateGraph !== 'function') {
      return;
    }

    const result = validateGraph(graph);
    if (typeof result === 'boolean') {
      expect(result).toBe(true);
      return;
    }

    expect(result.valid).toBe(true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      return;
    }
    throw error;
  }
}

describe('graph classifier', () => {
  test('returns SIMPLE below threshold without parallel work and verification', () => {
    expect(classify(BASE_SIMPLE_SIGNALS)).toBe('SIMPLE');
  });

  test('returns PROJECT at the 30 minute boundary', () => {
    expect(classify({ ...BASE_SIMPLE_SIGNALS, estimatedMinutes: 30 })).toBe('PROJECT');
  });

  test('returns PROJECT when parallel work is needed below threshold', () => {
    expect(classify({ ...BASE_SIMPLE_SIGNALS, hasParallelWork: true })).toBe('PROJECT');
  });

  test('returns PROJECT when verification is required below threshold', () => {
    expect(classify({ ...BASE_SIMPLE_SIGNALS, requiresVerification: true })).toBe('PROJECT');
  });

  test('extracts classification signals from intake text and metadata', () => {
    const signals = extractClassificationSignals({
      summary: 'Refactor auth module across 4 files and run tests with API review',
      componentCount: 2,
    });

    expect(signals.fileCount).toBe(4);
    expect(signals.componentCount).toBe(2);
    expect(signals.requiresVerification).toBe(true);
    expect(signals.hasExternalDeps).toBe(true);
    expect(signals.keywords).toContain('refactor');
  });
});

describe('graph planner', () => {
  test('SIMPLE mode produces a valid minimal graph', () => {
    const graph = buildSimpleGraph({
      taskId: 'task-simple',
      taskTitle: 'Fix typo in UI copy',
      graphId: 'graph-simple',
      now: '2026-02-14T00:00:00.000Z',
      signals: BASE_SIMPLE_SIGNALS,
    });

    expect(graph.mode).toBe('SIMPLE');
    expect(Object.keys(graph.nodes)).toEqual(['work-main']);
    expect(graph.nodes['work-main'].type).toBe('work');
    expect(Object.values(graph.nodes).some((node) => node.type === 'gate')).toBe(false);
    expect(graph.edges).toHaveLength(0);

    assertStructuralValidity(graph);
    runOptionalValidateGraph(graph);
  });

  test('PROJECT mode includes checkpoint gate coverage on all completion paths', () => {
    const projectSignals: ClassificationSignals = {
      estimatedMinutes: 120,
      hasExternalDeps: true,
      hasParallelWork: true,
      requiresVerification: true,
      fileCount: 10,
      componentCount: 3,
      hasMultiplePhases: true,
      keywords: ['feature'],
    };

    const graph = buildProjectGraph({
      taskId: 'task-project',
      taskTitle: 'Ship authentication feature',
      graphId: 'graph-project',
      now: '2026-02-14T00:00:00.000Z',
      signals: projectSignals,
    });

    expect(graph.mode).toBe('PROJECT');
    expect(Object.values(graph.nodes).some((node) => node.type === 'fork')).toBe(true);
    expect(Object.values(graph.nodes).some((node) => node.type === 'join')).toBe(true);
    expect(Object.values(graph.nodes).some(isCheckpointNode)).toBe(true);

    assertStructuralValidity(graph);
    assertCheckpointOnEachCompletionPath(graph);
    runOptionalValidateGraph(graph);
  });

  test('generated graphs are structurally valid in both modes', () => {
    const graphs = [
      generateInitialGraph({
        taskId: 'task-generated-simple',
        graphId: 'generated-simple',
        now: '2026-02-14T00:00:00.000Z',
        signals: BASE_SIMPLE_SIGNALS,
      }),
      generateInitialGraph({
        taskId: 'task-generated-project',
        graphId: 'generated-project',
        now: '2026-02-14T00:00:00.000Z',
        signals: {
          ...BASE_SIMPLE_SIGNALS,
          estimatedMinutes: 90,
          hasParallelWork: true,
          requiresVerification: true,
          fileCount: 7,
          componentCount: 3,
          hasMultiplePhases: true,
          keywords: ['feature'],
        },
      }),
    ];

    for (const graph of graphs) {
      assertStructuralValidity(graph);
      runOptionalValidateGraph(graph);
    }
  });
});

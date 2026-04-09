import { DEFAULT_EXECUTION_POLICY } from './constants';
import { classify, type ClassificationSignals } from './classifier';
import type {
  Edge,
  ExecutionGraph,
  ForkNode,
  GateNode,
  GraphNode,
  JoinNode,
  RetryPolicy,
  WorkNode,
} from './types';

export interface GraphPlanInput {
  taskId: string;
  taskTitle?: string;
  graphId?: string;
  now?: string;
  signals: ClassificationSignals;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  backoffMs: 5_000,
  onExhaust: 'escalate',
};

interface GraphParts {
  nodes: Record<string, GraphNode>;
  edges: Edge[];
}

function buildGraphId(taskId: string): string {
  const normalizedTask = taskId.trim() || 'task';
  return `graph-${normalizedTask}-${Date.now()}`;
}

function makeTimestamp(inputNow?: string): string {
  return inputNow ?? new Date().toISOString();
}

function addNode(parts: GraphParts, nodeId: string, node: GraphNode): void {
  if (parts.nodes[nodeId]) {
    throw new Error(`Duplicate node id: ${nodeId}`);
  }

  parts.nodes[nodeId] = node;

  for (const dep of node.deps) {
    parts.edges.push({
      from: dep,
      to: nodeId,
      type: 'hard',
    });
  }
}

function createWorkNode(
  title: string,
  deps: string[],
  estimateMinutes: number,
): WorkNode {
  return {
    type: 'work',
    status: 'pending',
    deps,
    title,
    estimateMinutes,
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
  };
}

function createGateNode(
  gateType: GateNode['gateType'],
  deps: string[],
  required: boolean,
  verificationStrategy: GateNode['verificationStrategy'],
): GateNode {
  return {
    type: 'gate',
    status: 'pending',
    gateType,
    required,
    deps,
    verificationStrategy,
  };
}

function createForkNode(deps: string[]): ForkNode {
  return {
    type: 'fork',
    status: 'pending',
    deps,
  };
}

function createJoinNode(deps: string[]): JoinNode {
  return {
    type: 'join',
    status: 'pending',
    deps,
    joinStrategy: 'all',
  };
}

function createBaseGraph(
  input: GraphPlanInput,
  mode: ExecutionGraph['mode'],
  parts: GraphParts,
  completionSinkNodeIds: string[],
): ExecutionGraph {
  const now = makeTimestamp(input.now);

  return {
    id: input.graphId ?? buildGraphId(input.taskId),
    taskId: input.taskId,
    graphVersion: 1,
    mode,
    nodes: parts.nodes,
    edges: parts.edges,
    policy: { ...DEFAULT_EXECUTION_POLICY },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds,
    },
    versionHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSimpleGraph(input: GraphPlanInput): ExecutionGraph {
  const workNodeId = 'work-main';
  const parts: GraphParts = { nodes: {}, edges: [] };

  addNode(
    parts,
    workNodeId,
    createWorkNode(
      input.taskTitle?.trim() || 'Complete task',
      [],
      Math.max(1, Math.min(input.signals.estimatedMinutes, 30)),
    ),
  );

  return createBaseGraph(input, 'SIMPLE', parts, [workNodeId]);
}

function computeParallelBranchCount(signals: ClassificationSignals): number {
  if (!signals.hasParallelWork) {
    return 1;
  }

  const scopeDrivenCount = Math.max(
    2,
    Math.min(4, Math.max(signals.componentCount, Math.ceil(signals.fileCount / 3))),
  );

  return scopeDrivenCount;
}

function buildQualityChecks(signals: ClassificationSignals): string[] {
  const checks = ['smoke_check'];

  if (signals.requiresVerification) {
    checks.push('tests_pass', 'lint_clean');
  }

  if (signals.fileCount > 5) {
    checks.push('typecheck');
  }

  return checks;
}

export function buildProjectGraph(input: GraphPlanInput): ExecutionGraph {
  const parts: GraphParts = { nodes: {}, edges: [] };
  const branchCount = computeParallelBranchCount(input.signals);
  let currentNodeId = 'work-discovery';

  addNode(
    parts,
    currentNodeId,
    createWorkNode(
      input.taskTitle?.trim() || 'Scope task',
      [],
      Math.max(15, Math.min(60, Math.round(input.signals.estimatedMinutes * 0.25))),
    ),
  );

  if (input.signals.hasMultiplePhases) {
    const planningNodeId = 'work-plan';
    addNode(parts, planningNodeId, createWorkNode('Plan implementation', [currentNodeId], 20));
    currentNodeId = planningNodeId;
  }

  if (branchCount > 1) {
    const forkNodeId = 'fork-workstreams';
    addNode(parts, forkNodeId, createForkNode([currentNodeId]));

    const branchNodeIds: string[] = [];
    const perBranchEstimate = Math.max(
      20,
      Math.round(input.signals.estimatedMinutes / (branchCount + 1)),
    );

    for (let index = 0; index < branchCount; index += 1) {
      const nodeId = `work-implement-${index + 1}`;
      addNode(
        parts,
        nodeId,
        createWorkNode(`Implement stream ${index + 1}`, [forkNodeId], perBranchEstimate),
      );
      branchNodeIds.push(nodeId);
    }

    const joinNodeId = 'join-workstreams';
    addNode(parts, joinNodeId, createJoinNode(branchNodeIds));
    currentNodeId = joinNodeId;
  } else {
    const implementationNodeId = 'work-implement';
    addNode(
      parts,
      implementationNodeId,
      createWorkNode(
        'Implement changes',
        [currentNodeId],
        Math.max(20, Math.round(input.signals.estimatedMinutes * 0.5)),
      ),
    );
    currentNodeId = implementationNodeId;
  }

  const checkpointGateId = 'checkpoint-progress';
  addNode(
    parts,
    checkpointGateId,
    createGateNode('progress', [currentNodeId], false, {
      type: 'auto',
    }),
  );
  currentNodeId = checkpointGateId;

  const qualityGateId = 'quality-gate';
  addNode(
    parts,
    qualityGateId,
    createGateNode('quality_gate', [currentNodeId], true, {
      type: 'auto',
      checks: buildQualityChecks(input.signals),
      timeout: 300_000,
    }),
  );
  currentNodeId = qualityGateId;

  const handoffGateId = 'handoff-gate';
  addNode(
    parts,
    handoffGateId,
    createGateNode('handoff_gate', [currentNodeId], true, {
      type: 'human',
    }),
  );

  return createBaseGraph(input, 'PROJECT', parts, [handoffGateId]);
}

export function generateInitialGraph(input: GraphPlanInput): ExecutionGraph {
  const mode = classify(input.signals);
  return mode === 'SIMPLE' ? buildSimpleGraph(input) : buildProjectGraph(input);
}

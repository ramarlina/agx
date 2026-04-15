import {
  FAILURE_NODE_STATUSES,
  INCOMPLETE_FOR_DONE_STATUSES,
  SOFT_DEP_SATISFIED_STATUSES,
  SUCCESS_NODE_STATUSES,
  TERMINAL_NODE_STATUSES,
} from './constants';
import { evaluateCondition } from './condition';
import {
  transitionConditionalNode,
  transitionForkNode,
  transitionFunctionNode,
  transitionJoinNode,
  transitionWorkNode,
  transitionGateNode,
} from './state-machine';
import type {
  ConditionalNode,
  Edge,
  ExecutionGraph,
  GraphSchedule,
  GraphNode,
  NodeStatus,
} from './types';
import { CronExpressionParser } from 'cron-parser';

/**
 * Compute the next tick timestamp from a cron expression.
 * Returns epoch ms, or undefined if the expression is invalid.
 */
export function computeNextTickFromCron(cronExpr: string, fromDate?: Date): number | undefined {
  try {
    const expr = CronExpressionParser.parse(cronExpr, { currentDate: fromDate });
    return expr.next().toDate().getTime();
  } catch {
    return undefined;
  }
}

const SOFT_DEP_SATISFIED_STATUS_SET = new Set<NodeStatus>(SOFT_DEP_SATISFIED_STATUSES);
const SUCCESS_STATUS_SET = new Set<NodeStatus>(SUCCESS_NODE_STATUSES);
const FAILURE_STATUS_SET = new Set<NodeStatus>(FAILURE_NODE_STATUSES);
const TERMINAL_STATUS_SET = new Set<NodeStatus>(TERMINAL_NODE_STATUSES);
const INCOMPLETE_FOR_DONE_STATUS_SET = new Set<NodeStatus>(INCOMPLETE_FOR_DONE_STATUSES);
const DONE_SINK_STATUS_SET = new Set<NodeStatus>(['done', 'passed', 'skipped']);

function findDependencyEdge(
  graph: ExecutionGraph,
  depId: string,
  nodeId: string,
): Edge | undefined {
  return graph.edges.find((edge) => edge.from === depId && edge.to === nodeId);
}

export function isDepSatisfied(
  graph: ExecutionGraph,
  depId: string,
  nodeId: string,
): boolean {
  const depNode = graph.nodes[depId];
  if (!depNode) {
    return false;
  }

  const edge = findDependencyEdge(graph, depId, nodeId) ?? {
    from: depId,
    to: nodeId,
    type: 'hard' as const,
    condition: 'on_success' as const,
  };

  if (edge.type === 'soft') {
    return SOFT_DEP_SATISFIED_STATUS_SET.has(depNode.status);
  }

  if ((edge.condition ?? 'on_success') === 'on_success') {
    return SUCCESS_STATUS_SET.has(depNode.status);
  }

  if (edge.condition === 'on_failure') {
    return FAILURE_STATUS_SET.has(depNode.status);
  }

  return TERMINAL_STATUS_SET.has(depNode.status);
}

function areNodeDepsSatisfied(graph: ExecutionGraph, nodeId: string, deps: string[]): boolean {
  return deps.every((depId) => isDepSatisfied(graph, depId, nodeId));
}

function buildHardOutgoingMap(graph: ExecutionGraph): Map<string, string[]> {
  const outgoingBySource = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.type !== 'hard') {
      continue;
    }
    const existing = outgoingBySource.get(edge.from);
    if (existing) {
      existing.push(edge.to);
    } else {
      outgoingBySource.set(edge.from, [edge.to]);
    }
  }

  return outgoingBySource;
}

function collectReachableNodeIds(
  hardOutgoing: Map<string, string[]>,
  roots: string[],
): Set<string> {
  const reachable = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);

    for (const nextNodeId of hardOutgoing.get(nodeId) ?? []) {
      if (!reachable.has(nextNodeId)) {
        queue.push(nextNodeId);
      }
    }
  }

  return reachable;
}

function skipNodeIfPending(node: GraphNode): GraphNode {
  if (node.status !== 'pending') {
    return node;
  }

  if (node.type === 'work') {
    return transitionWorkNode(node, { type: 'SKIP' });
  }
  if (node.type === 'function') {
    return transitionFunctionNode(node, { type: 'SKIP' });
  }
  if (node.type === 'gate') {
    return transitionGateNode(node, { type: 'SKIP' });
  }
  if (node.type === 'fork') {
    return transitionForkNode(node, { type: 'SKIP' });
  }
  if (node.type === 'join') {
    return transitionJoinNode(node, { type: 'SKIP' });
  }
  if (node.type === 'conditional') {
    return transitionConditionalNode(node, { type: 'SKIP' }).node;
  }

  return node;
}

function applyConditionalBranchSkips(
  graph: ExecutionGraph,
  enabledBranchNodeIds: string[],
  skippedBranchNodeIds: string[],
): string[] {
  if (skippedBranchNodeIds.length === 0) {
    return [];
  }

  const hardOutgoing = buildHardOutgoingMap(graph);
  const enabledReachable = collectReachableNodeIds(hardOutgoing, enabledBranchNodeIds);
  const skippedReachable = collectReachableNodeIds(hardOutgoing, skippedBranchNodeIds);
  const changedNodeIds: string[] = [];

  for (const nodeId of Object.keys(graph.nodes)) {
    if (!skippedReachable.has(nodeId) || enabledReachable.has(nodeId)) {
      continue;
    }
    const current = graph.nodes[nodeId];
    const next = skipNodeIfPending(current);
    if (next.status !== current.status) {
      graph.nodes[nodeId] = next;
      changedNodeIds.push(nodeId);
    }
  }

  return changedNodeIds;
}

function resolveConditionContext(
  graph: ExecutionGraph,
  nodeId: string,
  node: ConditionalNode,
  overrides: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const sourceNode = graph.nodes[node.condition.inputFrom];
  const sourceOutput =
    sourceNode && 'output' in sourceNode
      ? (sourceNode.output ?? null)
      : null;

  return {
    graph,
    nodeId,
    inputFrom: node.condition.inputFrom,
    input: sourceOutput,
    ctx: {
      graph,
      nodeId,
      inputFrom: node.condition.inputFrom,
      input: sourceOutput,
    },
    ...(overrides[nodeId] ?? {}),
  };
}

function hasStructuredConditionInput(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

export interface ControlEvaluationOptions {
  conditionContextByNodeId?: Record<string, Record<string, unknown>>;
}

export interface ControlEvaluationResult {
  forkNodeIds: string[];
  conditionalNodeIds: string[];
  joinNodeIds: string[];
  skippedByConditionalNodeIds: string[];
}

export function evaluateControlNodes(
  graph: ExecutionGraph,
  options: ControlEvaluationOptions = {},
): ControlEvaluationResult {
  const nextGraph = graph;
  const changedForkNodeIds: string[] = [];
  const changedConditionalNodeIds: string[] = [];
  const changedJoinNodeIds: string[] = [];
  const skippedByConditionalNodeIds: string[] = [];
  const conditionContextByNodeId = options.conditionContextByNodeId ?? {};

  for (const [nodeId, node] of Object.entries(nextGraph.nodes)) {
    if (node.type !== 'fork' || node.status !== 'pending') {
      continue;
    }
    if (!areNodeDepsSatisfied(nextGraph, nodeId, node.deps)) {
      continue;
    }
    const next = transitionForkNode(node, { type: 'ACTIVATE', depsSatisfied: true });
    if (next.status !== node.status) {
      nextGraph.nodes[nodeId] = next;
      changedForkNodeIds.push(nodeId);
    }
  }

  for (const [nodeId, node] of Object.entries(nextGraph.nodes)) {
    if (node.type !== 'conditional' || node.status !== 'pending') {
      continue;
    }
    if (!areNodeDepsSatisfied(nextGraph, nodeId, node.deps)) {
      continue;
    }

    const started = transitionConditionalNode(node, { type: 'START', depsSatisfied: true }).node;

    try {
      const conditionContext = resolveConditionContext(
        nextGraph,
        nodeId,
        node,
        conditionContextByNodeId,
      );
      // Fail-safe: if inputFrom cannot resolve to structured upstream output, route to else.
      const result = hasStructuredConditionInput(conditionContext.input)
        ? evaluateCondition(node.condition.expression, conditionContext)
        : false;
      const completed = transitionConditionalNode(started, {
        type: result ? 'CONDITION_TRUE' : 'CONDITION_FALSE',
      });
      nextGraph.nodes[nodeId] = completed.node;
      changedConditionalNodeIds.push(nodeId);

      const skippedNodeIds = applyConditionalBranchSkips(
        nextGraph,
        completed.enabledBranchNodeIds,
        completed.skippedBranchNodeIds,
      );
      skippedByConditionalNodeIds.push(...skippedNodeIds);
    } catch {
      const failed = transitionConditionalNode(started, { type: 'CONDITION_ERROR' }).node;
      nextGraph.nodes[nodeId] = failed;
      changedConditionalNodeIds.push(nodeId);
    }
  }

  for (const [nodeId, node] of Object.entries(nextGraph.nodes)) {
    if (node.type !== 'join') {
      continue;
    }
    if (node.status !== 'pending' && node.status !== 'running') {
      continue;
    }

    const dependencies = node.deps.map((depId) => {
      const depNode = nextGraph.nodes[depId];
      const edge = findDependencyEdge(nextGraph, depId, nodeId);
      return {
        nodeId: depId,
        status: depNode?.status ?? 'failed',
        edgeType: edge?.type ?? 'hard',
      };
    });

    const next = transitionJoinNode(node, {
      type: 'EVALUATE',
      dependencies,
    });
    if (next.status !== node.status) {
      nextGraph.nodes[nodeId] = next;
      changedJoinNodeIds.push(nodeId);
    }
  }

  return {
    forkNodeIds: changedForkNodeIds,
    conditionalNodeIds: changedConditionalNodeIds,
    joinNodeIds: changedJoinNodeIds,
    skippedByConditionalNodeIds,
  };
}

export interface RunnableNodeSets {
  workRunnable: string[];
  functionRunnable: string[];
  lightweightGateRunnable: string[];
  autoGateRunnable: string[];
}

export function findRunnableWorkAndGateNodes(graph: ExecutionGraph): RunnableNodeSets {
  const workRunnable: string[] = [];
  const functionRunnable: string[] = [];
  const lightweightGateRunnable: string[] = [];
  const autoGateRunnable: string[] = [];

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'work' && node.type !== 'gate' && node.type !== 'function') {
      continue;
    }
    if (node.status !== 'pending') {
      continue;
    }
    if (!areNodeDepsSatisfied(graph, nodeId, node.deps)) {
      continue;
    }

    if (node.type === 'function') {
      functionRunnable.push(nodeId);
      continue;
    }

    if (node.type === 'work') {
      workRunnable.push(nodeId);
      continue;
    }

    if (node.verificationStrategy.type === 'human') {
      lightweightGateRunnable.push(nodeId);
    } else {
      autoGateRunnable.push(nodeId);
    }
  }

  return {
    workRunnable,
    functionRunnable,
    lightweightGateRunnable,
    autoGateRunnable,
  };
}

function computeCriticalPathScores(graph: ExecutionGraph): Map<string, number> {
  const scores = new Map<string, number>();
  const inProgress = new Set<string>();
  const hardOutgoing = buildHardOutgoingMap(graph);

  const dfs = (nodeId: string): number => {
    const memoized = scores.get(nodeId);
    if (memoized !== undefined) {
      return memoized;
    }
    if (inProgress.has(nodeId)) {
      return 0;
    }
    inProgress.add(nodeId);

    const node = graph.nodes[nodeId];
    if (!node) {
      inProgress.delete(nodeId);
      scores.set(nodeId, 0);
      return 0;
    }

    const selfWeight = Math.max(1, node.estimateMinutes ?? 1);
    const children = hardOutgoing.get(nodeId) ?? [];
    const childWeight = children.length === 0 ? 0 : Math.max(...children.map(dfs));
    const total = selfWeight + childWeight;

    scores.set(nodeId, total);
    inProgress.delete(nodeId);
    return total;
  };

  for (const nodeId of Object.keys(graph.nodes)) {
    dfs(nodeId);
  }

  return scores;
}

export function prioritizeNodeIds(graph: ExecutionGraph, nodeIds: string[]): string[] {
  const ordered = [...nodeIds];
  if (graph.policy.priorityMode === 'fifo') {
    return ordered;
  }

  const indexByNodeId = new Map<string, number>();
  nodeIds.forEach((nodeId, index) => {
    indexByNodeId.set(nodeId, index);
  });

  if (graph.policy.priorityMode === 'shortest_first') {
    ordered.sort((left, right) => {
      const leftEstimate = graph.nodes[left]?.estimateMinutes ?? Number.POSITIVE_INFINITY;
      const rightEstimate = graph.nodes[right]?.estimateMinutes ?? Number.POSITIVE_INFINITY;
      if (leftEstimate !== rightEstimate) {
        return leftEstimate - rightEstimate;
      }
      return (indexByNodeId.get(left) ?? 0) - (indexByNodeId.get(right) ?? 0);
    });
    return ordered;
  }

  const criticalScores = computeCriticalPathScores(graph);
  ordered.sort((left, right) => {
    const leftScore = criticalScores.get(left) ?? 0;
    const rightScore = criticalScores.get(right) ?? 0;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return (indexByNodeId.get(left) ?? 0) - (indexByNodeId.get(right) ?? 0);
  });

  return ordered;
}

export function isExecutionComplete(graph: ExecutionGraph): boolean {
  if (graph.doneCriteria.allRequiredGatesPassed) {
    const requiredGateNodes = Object.values(graph.nodes).filter(
      (node) => node.type === 'gate' && node.required,
    );
    if (
      requiredGateNodes.some(
        (gateNode) => gateNode.status !== 'passed' && gateNode.status !== 'skipped',
      )
    ) {
      return false;
    }
  }

  if (graph.doneCriteria.noRunnableOrPendingWork) {
    const hasIncompleteNode = Object.values(graph.nodes).some((node) =>
      INCOMPLETE_FOR_DONE_STATUS_SET.has(node.status),
    );
    if (hasIncompleteNode) {
      return false;
    }
  }

  if (graph.doneCriteria.completionSinkNodeIds?.length) {
    for (const nodeId of graph.doneCriteria.completionSinkNodeIds) {
      const sinkNode = graph.nodes[nodeId];
      if (!sinkNode || !DONE_SINK_STATUS_SET.has(sinkNode.status)) {
        return false;
      }
    }
  }

  if (graph.doneCriteria.customCriteria?.length) {
    for (const criterion of graph.doneCriteria.customCriteria) {
      try {
        const passed = evaluateCondition(criterion, { graph });
        if (!passed) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }

  return true;
}

function countRunningWorkNodes(graph: ExecutionGraph): number {
  return Object.values(graph.nodes).filter(
    (node) => node.type === 'work' && node.status === 'running',
  ).length;
}

function countRunningAutoChecks(graph: ExecutionGraph): number {
  return Object.values(graph.nodes).filter(
    (node) =>
      node.type === 'gate' &&
      node.status === 'running' &&
      node.verificationStrategy.type !== 'human',
  ).length;
}

export interface CreateGraphScheduleInput {
  intervalMs: number;
  cronExpr?: string;
  cadence?: string;
  name?: string;
  description?: string;
  resetNodeIds: string[];
  maxRuns?: number;
  maxConcurrency?: number;
  maxConsecutiveFailures?: number;
  activeUntil?: string;
  rootMessageId?: string;
  nowIso?: string;
}

export type ScheduledTickSkipReason =
  | 'no_schedule'
  | 'inactive'
  | 'overlap'
  | 'before_interval'
  | 'max_runs_reached'
  | 'expired';

export interface PrepareScheduledTickResult {
  graph: ExecutionGraph;
  shouldRun: boolean;
  skipReason?: ScheduledTickSkipReason;
}

function resetNodeForScheduledTick(node: GraphNode): GraphNode {
  if (node.type === 'root') {
    return node;
  }

  const resetBase: GraphNode = {
    ...node,
    status: 'pending',
    startedAt: undefined,
    completedAt: undefined,
    actualMinutes: undefined,
  } as GraphNode;

  if (resetBase.type === 'work') {
    return {
      ...resetBase,
      attempts: 0,
      output: undefined,
    };
  }

  if (resetBase.type === 'function') {
    return {
      ...resetBase,
      output: undefined,
    };
  }

  if (resetBase.type === 'gate') {
    return {
      ...resetBase,
      verificationResult: undefined,
    };
  }

  if (resetBase.type === 'conditional') {
    return {
      ...resetBase,
      evaluatedTo: undefined,
    };
  }

  return resetBase;
}

function normalizeIntervalMs(intervalMs: number): number {
  return Math.max(1, Math.trunc(intervalMs));
}

function normalizeOptionalMaxRuns(maxRuns: number | undefined): number | undefined {
  if (maxRuns === undefined) {
    return undefined;
  }
  return Math.max(1, Math.trunc(maxRuns));
}

function normalizeOptionalIso(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function shouldStopByExpiry(schedule: GraphSchedule, nowMs: number): boolean {
  if (!schedule.activeUntil) {
    return false;
  }
  const expiresAtMs = Date.parse(schedule.activeUntil);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return nowMs >= expiresAtMs;
}

export function createGraphSchedule(input: CreateGraphScheduleInput): GraphSchedule {
  const schedule: GraphSchedule = {
    intervalMs: normalizeIntervalMs(input.intervalMs),
    state: 'active',
    resetNodeIds: input.resetNodeIds,
    maxRuns: normalizeOptionalMaxRuns(input.maxRuns),
    runCount: 0,
    tickInProgress: false,
    currentConcurrency: 0,
    maxConcurrency: input.maxConcurrency,
    createdAt: normalizeOptionalIso(input.nowIso) ?? new Date().toISOString(),
    activeUntil: normalizeOptionalIso(input.activeUntil),
    rootMessageId: input.rootMessageId?.trim() || undefined,
    cronExpr: input.cronExpr?.trim() || undefined,
    cadence: input.cadence?.trim() || undefined,
    name: input.name?.trim() || undefined,
    description: input.description?.trim() || undefined,
    maxConsecutiveFailures: input.maxConsecutiveFailures,
    consecutiveFailures: 0,
  };

  // Compute nextTickAt from cron expression if present
  if (schedule.cronExpr) {
    schedule.nextTickAt = computeNextTickFromCron(schedule.cronExpr);
  }

  return schedule;
}

export function activateGraphSchedule(
  graph: ExecutionGraph,
  input: CreateGraphScheduleInput,
): ExecutionGraph {
  if (graph.schedule?.state === 'active') {
    return graph;
  }

  const schedule = createGraphSchedule(input);
  return {
    ...graph,
    schedule,
    updatedAt: new Date().toISOString(),
  };
}

export function deactivateGraphSchedule(graph: ExecutionGraph): ExecutionGraph {
  if (!graph.schedule || graph.schedule.state === 'stopped') {
    return graph;
  }

  return {
    ...graph,
    schedule: {
      ...graph.schedule,
      state: 'stopped',
      tickInProgress: false,
      currentConcurrency: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function prepareScheduledTick(
  graph: ExecutionGraph,
  nowMs: number = Date.now(),
): PrepareScheduledTickResult {
  const schedule = graph.schedule;
  if (!schedule) {
    return { graph, shouldRun: false, skipReason: 'no_schedule' };
  }
  if (schedule.state !== 'active') {
    return { graph, shouldRun: false, skipReason: 'inactive' };
  }
  const maxConcurrency = schedule.maxConcurrency ?? 5;
  const currentConcurrency = schedule.currentConcurrency ?? 0;
  if (currentConcurrency >= maxConcurrency) {
    return { graph, shouldRun: false, skipReason: 'overlap' };
  }
  if (schedule.maxRuns !== undefined && schedule.runCount >= schedule.maxRuns) {
    return {
      graph: deactivateGraphSchedule(graph),
      shouldRun: false,
      skipReason: 'max_runs_reached',
    };
  }
  if (shouldStopByExpiry(schedule, nowMs)) {
    return {
      graph: deactivateGraphSchedule(graph),
      shouldRun: false,
      skipReason: 'expired',
    };
  }
  // Check timing: cron-based (nextTickAt) or interval-based
  if (schedule.cronExpr && typeof schedule.nextTickAt === 'number') {
    if (nowMs < schedule.nextTickAt) {
      return { graph, shouldRun: false, skipReason: 'before_interval' };
    }
  } else if (
    typeof schedule.lastTickAt === 'number'
    && nowMs - schedule.lastTickAt < schedule.intervalMs
  ) {
    return { graph, shouldRun: false, skipReason: 'before_interval' };
  }

  const nextGraph = structuredClone(graph);
  nextGraph.schedule = {
    ...schedule,
    tickInProgress: true,
    currentConcurrency: currentConcurrency + 1,
    lastTickAt: nowMs,
  };
  for (const nodeId of schedule.resetNodeIds) {
    const node = nextGraph.nodes[nodeId];
    if (!node) {
      continue;
    }
    nextGraph.nodes[nodeId] = resetNodeForScheduledTick(node);
  }

  return { graph: nextGraph, shouldRun: true };
}

export function finalizeScheduledTick(
  graph: ExecutionGraph,
  nowMs: number = Date.now(),
): ExecutionGraph {
  const schedule = graph.schedule;
  if (!schedule) {
    return graph;
  }

  const currentConcurrency = schedule.currentConcurrency ?? (schedule.tickInProgress ? 1 : 0);
  const newConcurrency = Math.max(0, currentConcurrency - 1);
  const runCount = schedule.tickInProgress ? schedule.runCount + 1 : schedule.runCount;
  const shouldStop = schedule.maxRuns !== undefined && runCount >= schedule.maxRuns;

  // Compute next tick for cron schedules
  let nextTickAt = schedule.nextTickAt;
  if (schedule.cronExpr && !shouldStop) {
    nextTickAt = computeNextTickFromCron(schedule.cronExpr, new Date(nowMs));
  }

  return {
    ...graph,
    schedule: {
      ...schedule,
      runCount,
      tickInProgress: newConcurrency > 0,
      currentConcurrency: newConcurrency,
      state: shouldStop ? 'stopped' : schedule.state,
      lastTickAt: schedule.lastTickAt ?? nowMs,
      nextTickAt,
    },
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export interface SchedulerTickOptions extends ControlEvaluationOptions {}

export interface SchedulerTickResult extends RunnableNodeSets {
  graph: ExecutionGraph;
  control: ControlEvaluationResult;
  workToRun: string[];
  functionToRun: string[];
  lightweightGatesToRun: string[];
  autoGatesToRun: string[];
  dispatchOrder: string[];
  complete: boolean;
}

export function schedulerTick(
  graph: ExecutionGraph,
  options: SchedulerTickOptions = {},
): SchedulerTickResult {
  const nextGraph = structuredClone(graph);

  const control = evaluateControlNodes(nextGraph, options);
  const runnable = findRunnableWorkAndGateNodes(nextGraph);

  const availableWork = Math.max(
    0,
    nextGraph.policy.maxConcurrent - countRunningWorkNodes(nextGraph),
  );
  const availableAutoChecks = Math.max(
    0,
    nextGraph.policy.maxConcurrentAutoChecks - countRunningAutoChecks(nextGraph),
  );

  const workToRun = prioritizeNodeIds(nextGraph, runnable.workRunnable).slice(0, availableWork);
  // Function nodes are lightweight (no agent) — dispatch all of them without concurrency limits
  const functionToRun = [...runnable.functionRunnable];
  const lightweightGatesToRun = [...runnable.lightweightGateRunnable];
  const autoGatesToRun = runnable.autoGateRunnable.slice(0, availableAutoChecks);
  const dispatchOrder = [...functionToRun, ...lightweightGatesToRun, ...autoGatesToRun, ...workToRun];

  return {
    graph: nextGraph,
    control,
    ...runnable,
    workToRun,
    functionToRun,
    lightweightGatesToRun,
    autoGatesToRun,
    dispatchOrder,
    complete: isExecutionComplete(nextGraph),
  };
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { evaluateCondition } from './condition';
import {
  verifyGate,
  type GateVerificationOutcome,
  type HumanDecision,
} from './gate-verifier';
import { buildReplanFromFeedback } from './llm-review';
import { applyReplan, ReplanTrigger, type ReplanRequest } from './replan';
import { isDepSatisfied } from './scheduler';
import {
  transitionConditionalNode,
  transitionForkNode,
  transitionFunctionNode,
  transitionGateNode,
  transitionJoinNode,
  transitionWorkNode,
} from './state-machine';
import type {
  ExecutionGraph,
  FunctionNode,
  GraphNode,
  NodeMetrics,
  RuntimeEvent,
  WorkNode,
} from './types';

export type WorkDispatchResult =
  | {
      status: 'success';
      output?: Record<string, unknown>;
      tokensUsed?: number;
    }
  | {
      status: 'failure';
      transient?: boolean;
      message?: string;
      error?: unknown;
    }
  | {
      status: 'blocked';
      message?: string;
      error?: unknown;
    };

export type FunctionDispatchResult =
  | {
      status: 'success';
      output?: Record<string, unknown>;
    }
  | {
      status: 'failure';
      message?: string;
      error?: unknown;
    };

export interface ExecutorContext {
  dispatchWork?: (node: WorkNode, graph: ExecutionGraph) => Promise<WorkDispatchResult>;
  dispatchFunction?: (node: FunctionNode, graph: ExecutionGraph) => Promise<FunctionDispatchResult>;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  graphStartedAtMs?: number;
  conditionContextByNodeId?: Record<string, Record<string, unknown>>;
  humanDecisionsByGateId?: Record<string, HumanDecision>;
  checkCwd?: string;
  checkEnv?: NodeJS.ProcessEnv;
  checkExecutor?: Parameters<typeof verifyGate>[0]['executor'];
  makeReplanRequest?: (
    graph: ExecutionGraph,
    gateId: string,
    outcome: GateVerificationOutcome,
  ) => ReplanRequest | null;
  replan?: (graph: ExecutionGraph, request: ReplanRequest) => ExecutionGraph;
  onEscalateWorkFailure?: (
    node: WorkNode,
    error: Error,
    graph: ExecutionGraph,
  ) => Promise<void> | void;
  /** Generates a replan request from LLM review feedback (dispatched to daemon) */
  makeReplanFromReviewFeedback?: (
    graph: ExecutionGraph,
    gateId: string,
    feedback: string,
  ) => Promise<ReplanRequest | null>;
}

export interface ExecuteNodeResult {
  graph: ExecutionGraph;
  nodeId: string;
  node: GraphNode;
  events: RuntimeEvent[];
  replanApplied: boolean;
  timedOut: boolean;
}

export class GraphExecutionTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Graph execution exceeded timeout (${timeoutMs}ms).`);
    this.name = 'GraphExecutionTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class NodeExecutionTimeoutError extends Error {
  readonly nodeId: string;
  readonly timeoutMs: number;

  constructor(nodeId: string, timeoutMs: number) {
    super(`Node "${nodeId}" execution exceeded timeout (${timeoutMs}ms).`);
    this.name = 'NodeExecutionTimeoutError';
    this.nodeId = nodeId;
    this.timeoutMs = timeoutMs;
  }
}

const noOpSleep = async (): Promise<void> => undefined;
const execFileAsync = promisify(execFile);
const FUNCTION_STDOUT_MAX_BUFFER_BYTES = 64 * 1024;

function nowMs(context: ExecutorContext): number {
  return context.nowMs?.() ?? Date.now();
}

function nowIso(context: ExecutorContext): string {
  return new Date(nowMs(context)).toISOString();
}

function resolveGraphStartedAtMs(graph: ExecutionGraph, context: ExecutorContext): number {
  if (context.graphStartedAtMs !== undefined) {
    return context.graphStartedAtMs;
  }
  const parsed = Date.parse(graph.createdAt);
  return Number.isNaN(parsed) ? nowMs(context) : parsed;
}

function assertGraphWithinTimeout(graph: ExecutionGraph, context: ExecutorContext): void {
  if (!graph.policy.graphTimeoutMs) return; // 0 or undefined = no timeout
  const startedAtMs = resolveGraphStartedAtMs(graph, context);
  const elapsedMs = nowMs(context) - startedAtMs;
  if (elapsedMs > graph.policy.graphTimeoutMs) {
    throw new GraphExecutionTimeoutError(graph.policy.graphTimeoutMs);
  }
}

function resolveNodeTimeoutMs(graph: ExecutionGraph, node: GraphNode): number {
  if (
    node.type === 'gate' &&
    typeof node.verificationStrategy.timeout === 'number' &&
    node.verificationStrategy.timeout > 0
  ) {
    return node.verificationStrategy.timeout;
  }
  return Math.max(1, graph.policy.nodeTimeoutMs);
}

function extractFunctionOutputFromStdout(stdout: string, nodeId: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`Function node "${nodeId}" produced empty stdout.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Function node "${nodeId}" stdout is not valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Function node "${nodeId}" stdout JSON must be an object.`);
  }

  return parsed as Record<string, unknown>;
}

function formatFunctionDispatchError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: string | number;
      message?: string;
      stderr?: string;
      stdout?: string;
      killed?: boolean;
      signal?: string;
    };

    if (candidate.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return `Function stdout exceeded ${FUNCTION_STDOUT_MAX_BUFFER_BYTES} bytes.`;
    }

    if (candidate.killed && candidate.signal) {
      return `Function command timed out and was terminated (${candidate.signal}).`;
    }

    const stderr = candidate.stderr?.trim();
    if (stderr) {
      return stderr;
    }

    if (candidate.message) {
      return candidate.message;
    }
  }

  return typeof error === 'string' ? error : 'Unknown function execution error.';
}

async function dispatchBashFunctionNode(
  node: FunctionNode,
  graph: ExecutionGraph,
): Promise<FunctionDispatchResult> {
  const timeoutMs = Math.max(1, node.timeoutMs ?? graph.policy.nodeTimeoutMs);
  try {
    const { stdout } = await execFileAsync('bash', ['-lc', node.command], {
      timeout: timeoutMs,
      maxBuffer: FUNCTION_STDOUT_MAX_BUFFER_BYTES,
      env: process.env,
      windowsHide: true,
    });

    return {
      status: 'success',
      output: extractFunctionOutputFromStdout(stdout, node.command),
    };
  } catch (error) {
    return {
      status: 'failure',
      message: formatFunctionDispatchError(error),
      error,
    };
  }
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function appendError(node: GraphNode, errorMessage: string): GraphNode {
  const baseMetrics: NodeMetrics = node.metrics ?? {
    tokensUsed: 0,
    latencyMs: 0,
    retryCount: node.type === 'work' ? node.attempts : 0,
  };
  return {
    ...node,
    metrics: {
      ...baseMetrics,
      errorMessages: [...(baseMetrics.errorMessages ?? []), errorMessage],
      retryCount: node.type === 'work' ? node.attempts : baseMetrics.retryCount,
    },
  };
}

function finalizeMetrics(
  node: GraphNode,
  startedAtMs: number,
  context: ExecutorContext,
  tokensUsed?: number,
): GraphNode {
  const baseMetrics: NodeMetrics = node.metrics ?? {
    tokensUsed: 0,
    latencyMs: 0,
    retryCount: node.type === 'work' ? node.attempts : 0,
  };

  const completedAt =
    node.status === 'done' ||
    node.status === 'passed' ||
    node.status === 'failed' ||
    node.status === 'skipped'
      ? nowIso(context)
      : node.completedAt;

  return {
    ...node,
    completedAt,
    metrics: {
      ...baseMetrics,
      tokensUsed: baseMetrics.tokensUsed + (tokensUsed ?? 0),
      latencyMs: Math.max(0, nowMs(context) - startedAtMs),
      retryCount: node.type === 'work' ? node.attempts : baseMetrics.retryCount,
    },
  };
}

function resolveConditionContext(
  graph: ExecutionGraph,
  nodeId: string,
  contextByNodeId: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const node = graph.nodes[nodeId];
  if (!node || node.type !== 'conditional') {
    return { graph, nodeId, ctx: { graph, nodeId } };
  }
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
    ...(contextByNodeId[nodeId] ?? {}),
  };
}

function hasStructuredConditionInput(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

function skipBranchNodes(
  graph: ExecutionGraph,
  skippedNodeIds: string[],
): void {
  for (const skippedNodeId of skippedNodeIds) {
    const node = graph.nodes[skippedNodeId];
    if (!node || node.status !== 'pending') {
      continue;
    }

    if (node.type === 'work') {
      graph.nodes[skippedNodeId] = transitionWorkNode(node, { type: 'SKIP' });
    } else if (node.type === 'function') {
      graph.nodes[skippedNodeId] = transitionFunctionNode(node, { type: 'SKIP' });
    } else if (node.type === 'gate') {
      graph.nodes[skippedNodeId] = transitionGateNode(node, { type: 'SKIP' });
    } else if (node.type === 'fork') {
      graph.nodes[skippedNodeId] = transitionForkNode(node, { type: 'SKIP' });
    } else if (node.type === 'join') {
      graph.nodes[skippedNodeId] = transitionJoinNode(node, { type: 'SKIP' });
    } else if (node.type === 'conditional') {
      graph.nodes[skippedNodeId] = transitionConditionalNode(node, { type: 'SKIP' }).node;
    }
  }
}

async function handleWorkFailure(
  graph: ExecutionGraph,
  nodeId: string,
  node: WorkNode,
  context: ExecutorContext,
  error: Error,
  transient: boolean,
): Promise<WorkNode> {
  let next = transitionWorkNode(node, { type: 'FAIL', transient });

  if (next.status === 'pending') {
    const sleep = context.sleep ?? noOpSleep;
    await sleep(Math.max(0, node.retryPolicy.backoffMs));
  } else if (next.status === 'blocked' && node.retryPolicy.onExhaust === 'escalate') {
    await context.onEscalateWorkFailure?.(next, error, graph);
  }

  next = appendError(next, error.message) as WorkNode;
  return next;
}

async function executeWorkNode(
  graph: ExecutionGraph,
  nodeId: string,
  node: WorkNode,
  context: ExecutorContext,
): Promise<{ node: WorkNode; timedOut: boolean }> {
  let current = node;
  if (current.status === 'pending') {
    current = transitionWorkNode(current, { type: 'START', depsSatisfied: true });
  }
  if (!current.startedAt) {
    current = { ...current, startedAt: nowIso(context) };
  }

  const startedAtMs = nowMs(context);
  const timeoutMs = resolveNodeTimeoutMs(graph, current);
  let timedOut = false;

  try {
    const dispatch = context.dispatchWork ?? (async () => ({ status: 'success' as const }));
    const result = await withTimeout(
      dispatch(current, graph),
      timeoutMs,
      () => new NodeExecutionTimeoutError(nodeId, timeoutMs),
    );

    if (result.status === 'success') {
      const done = transitionWorkNode(current, { type: 'COMPLETE' });
      return {
        node: finalizeMetrics(
          {
            ...done,
            output: result.output ?? done.output,
          },
          startedAtMs,
          context,
          result.tokensUsed,
        ) as WorkNode,
        timedOut,
      };
    }

    if (result.status === 'blocked') {
      const blocked = transitionWorkNode(current, { type: 'BLOCK' });
      const blockedWithError = result.message ? appendError(blocked, result.message) : blocked;
      return {
        node: finalizeMetrics(blockedWithError, startedAtMs, context) as WorkNode,
        timedOut,
      };
    }

    const failureError = new Error(result.message ?? 'Work node failed.');
    const failed = await handleWorkFailure(
      graph,
      nodeId,
      current,
      context,
      failureError,
      result.transient ?? true,
    );
    return {
      node: finalizeMetrics(failed, startedAtMs, context) as WorkNode,
      timedOut,
    };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown work execution error');
    timedOut = normalizedError instanceof NodeExecutionTimeoutError;
    const failed = await handleWorkFailure(
      graph,
      nodeId,
      current,
      context,
      normalizedError,
      true,
    );
    return {
      node: finalizeMetrics(failed, startedAtMs, context) as WorkNode,
      timedOut,
    };
  }
}

async function executeGateNode(
  graph: ExecutionGraph,
  nodeId: string,
  context: ExecutorContext,
): Promise<{
  graph: ExecutionGraph;
  node: GraphNode;
  events: RuntimeEvent[];
  replanApplied: boolean;
  timedOut: boolean;
}> {
  const gate = graph.nodes[nodeId];
  if (!gate || gate.type !== 'gate') {
    throw new Error(`Node "${nodeId}" is not a gate node.`);
  }

  const startedAtMs = nowMs(context);
  const timeoutMs = resolveNodeTimeoutMs(graph, gate);
  let timedOut = false;
  let nextGraph = graph;
  let replanApplied = false;

  try {
    const outcome = await withTimeout(
      verifyGate({
        gateId: nodeId,
        gate,
        policy: nextGraph.policy,
        now: nowIso(context),
        humanDecision: context.humanDecisionsByGateId?.[nodeId],
        cwd: context.checkCwd,
        env: context.checkEnv,
        executor: context.checkExecutor,
        graph: nextGraph,
        dispatchReview: context.dispatchWork,
      }),
      timeoutMs,
      () => new NodeExecutionTimeoutError(nodeId, timeoutMs),
    );

    const updatedGate = finalizeMetrics(outcome.gate, startedAtMs, context);
    nextGraph.nodes[nodeId] = updatedGate;
    nextGraph.policy = outcome.policy;

    // LLM review failed: extend graph with fix nodes + new quality gate
    if (outcome.llmReviewFailed) {
      const feedback = outcome.llmReviewFeedback ?? 'Quality gate review failed';
      const makePlan = context.makeReplanFromReviewFeedback
        ?? (async (g: ExecutionGraph, gId: string, fb: string) => buildReplanFromFeedback(g, gId, fb));
      const request = await makePlan(nextGraph, nodeId, feedback);
      if (request) {
        const replan = context.replan ?? applyReplan;
        nextGraph = replan(nextGraph, request);
        replanApplied = true;
      }
    } else if (outcome.escalated && context.makeReplanRequest) {
      const request = context.makeReplanRequest(nextGraph, nodeId, outcome);
      if (request) {
        const replan = context.replan ?? applyReplan;
        nextGraph = replan(nextGraph, request);
        replanApplied = true;
      }
    }

    return {
      graph: nextGraph,
      node: nextGraph.nodes[nodeId],
      events: outcome.events,
      replanApplied,
      timedOut,
    };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown gate execution error');
    timedOut = normalizedError instanceof NodeExecutionTimeoutError;

    let failedGate = gate;
    if (failedGate.status === 'pending') {
      failedGate = transitionGateNode(failedGate, { type: 'START', depsSatisfied: true });
    }
    if (failedGate.status === 'running') {
      failedGate = transitionGateNode(failedGate, { type: 'AUTO_FAIL' });
    } else if (failedGate.status === 'awaiting_human') {
      failedGate = transitionGateNode(failedGate, { type: 'HUMAN_REJECT' });
    }

    const withError = appendError(failedGate, normalizedError.message);
    nextGraph.nodes[nodeId] = finalizeMetrics(withError, startedAtMs, context);

    return {
      graph: nextGraph,
      node: nextGraph.nodes[nodeId],
      events: [],
      replanApplied: false,
      timedOut,
    };
  }
}

function executeForkNode(
  graph: ExecutionGraph,
  nodeId: string,
): GraphNode {
  const node = graph.nodes[nodeId];
  if (!node || node.type !== 'fork') {
    throw new Error(`Node "${nodeId}" is not a fork node.`);
  }
  if (node.status !== 'pending') {
    return node;
  }

  if (!node.deps.every((depId) => isDepSatisfied(graph, depId, nodeId))) {
    return node;
  }

  const next = transitionForkNode(node, { type: 'ACTIVATE', depsSatisfied: true });
  graph.nodes[nodeId] = next;
  return next;
}

function executeJoinNode(
  graph: ExecutionGraph,
  nodeId: string,
): GraphNode {
  const node = graph.nodes[nodeId];
  if (!node || node.type !== 'join') {
    throw new Error(`Node "${nodeId}" is not a join node.`);
  }
  if (node.status !== 'pending' && node.status !== 'running') {
    return node;
  }

  const dependencies = node.deps.map((depId) => ({
    nodeId: depId,
    status: graph.nodes[depId]?.status ?? 'failed',
    edgeType:
      graph.edges.find((edge) => edge.from === depId && edge.to === nodeId)?.type ?? 'hard',
  }));
  const next = transitionJoinNode(node, { type: 'EVALUATE', dependencies });
  graph.nodes[nodeId] = next;
  return next;
}

async function executeFunctionNode(
  graph: ExecutionGraph,
  nodeId: string,
  node: FunctionNode,
  context: ExecutorContext,
): Promise<{ node: FunctionNode; timedOut: boolean }> {
  let current = node;
  if (current.status === 'pending') {
    current = transitionFunctionNode(current, { type: 'START', depsSatisfied: true });
  }
  if (!current.startedAt) {
    current = { ...current, startedAt: nowIso(context) };
  }

  const startedAtMs = nowMs(context);
  const timeoutMs = current.timeoutMs ?? graph.policy.nodeTimeoutMs;
  let timedOut = false;

  try {
    const dispatch =
      context.dispatchFunction ??
      (async (functionNode: FunctionNode, functionGraph: ExecutionGraph) => {
        if (functionNode.kind === 'bash') {
          return dispatchBashFunctionNode(functionNode, functionGraph);
        }
        const { createDispatchFunction } = await import('./function-executor');
        return createDispatchFunction()(functionNode, functionGraph);
      });
    const result = await withTimeout(
      dispatch(current, graph),
      timeoutMs,
      () => new NodeExecutionTimeoutError(nodeId, timeoutMs),
    );

    if (result.status === 'success') {
      const done = transitionFunctionNode(current, { type: 'COMPLETE' });
      return {
        node: finalizeMetrics(
          { ...done, output: result.output ?? done.output },
          startedAtMs,
          context,
        ) as FunctionNode,
        timedOut,
      };
    }

    const failed = transitionFunctionNode(current, { type: 'FAIL' });
    const withError = result.message ? appendError(failed, result.message) : failed;
    if (result.message?.toLowerCase().includes('timed out')) {
      timedOut = true;
    }
    return {
      node: finalizeMetrics(withError, startedAtMs, context) as FunctionNode,
      timedOut,
    };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown function execution error');
    timedOut = normalizedError instanceof NodeExecutionTimeoutError;
    const failed = transitionFunctionNode(current, { type: 'FAIL' });
    const withError = appendError(failed, normalizedError.message);
    return {
      node: finalizeMetrics(withError, startedAtMs, context) as FunctionNode,
      timedOut,
    };
  }
}

function executeConditionalNode(
  graph: ExecutionGraph,
  nodeId: string,
  context: ExecutorContext,
): GraphNode {
  const node = graph.nodes[nodeId];
  if (!node || node.type !== 'conditional') {
    throw new Error(`Node "${nodeId}" is not a conditional node.`);
  }
  if (node.status !== 'pending') {
    return node;
  }
  if (!node.deps.every((depId) => isDepSatisfied(graph, depId, nodeId))) {
    return node;
  }

  const started = transitionConditionalNode(node, {
    type: 'START',
    depsSatisfied: true,
  }).node;

  try {
    const conditionContext = resolveConditionContext(
      graph,
      nodeId,
      context.conditionContextByNodeId ?? {},
    );
    // Fail-safe: missing/unstructured input resolves to else branch without throwing.
    const evaluatedTrue = hasStructuredConditionInput(conditionContext.input)
      ? evaluateCondition(node.condition.expression, conditionContext)
      : false;
    const completed = transitionConditionalNode(started, {
      type: evaluatedTrue ? 'CONDITION_TRUE' : 'CONDITION_FALSE',
    });
    graph.nodes[nodeId] = completed.node;
    skipBranchNodes(graph, completed.skippedBranchNodeIds);
    return completed.node;
  } catch (error) {
    const failed = transitionConditionalNode(started, { type: 'CONDITION_ERROR' }).node;
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Condition evaluation failed.');
    graph.nodes[nodeId] = appendError(failed, normalizedError.message);
    return graph.nodes[nodeId];
  }
}

export async function executeNode(
  graph: ExecutionGraph,
  nodeId: string,
  context: ExecutorContext = {},
): Promise<ExecuteNodeResult> {
  assertGraphWithinTimeout(graph, context);

  const nextGraph = structuredClone(graph);
  const node = nextGraph.nodes[nodeId];
  if (!node) {
    throw new Error(`Unknown node "${nodeId}".`);
  }

  if (node.type === 'function') {
    const result = await executeFunctionNode(nextGraph, nodeId, node, context);
    nextGraph.nodes[nodeId] = result.node;
    return {
      graph: nextGraph,
      nodeId,
      node: nextGraph.nodes[nodeId],
      events: [],
      replanApplied: false,
      timedOut: result.timedOut,
    };
  }

  if (node.type === 'work') {
    const result = await executeWorkNode(nextGraph, nodeId, node, context);
    nextGraph.nodes[nodeId] = result.node;
    return {
      graph: nextGraph,
      nodeId,
      node: nextGraph.nodes[nodeId],
      events: [],
      replanApplied: false,
      timedOut: result.timedOut,
    };
  }

  if (node.type === 'gate') {
    const result = await executeGateNode(nextGraph, nodeId, context);
    return {
      graph: result.graph,
      nodeId,
      node: result.graph.nodes[nodeId],
      events: result.events,
      replanApplied: result.replanApplied,
      timedOut: result.timedOut,
    };
  }

  if (node.type === 'fork') {
    const updatedNode = executeForkNode(nextGraph, nodeId);
    return {
      graph: nextGraph,
      nodeId,
      node: updatedNode,
      events: [],
      replanApplied: false,
      timedOut: false,
    };
  }

  if (node.type === 'join') {
    const updatedNode = executeJoinNode(nextGraph, nodeId);
    return {
      graph: nextGraph,
      nodeId,
      node: updatedNode,
      events: [],
      replanApplied: false,
      timedOut: false,
    };
  }

  const updatedNode = executeConditionalNode(nextGraph, nodeId, context);
  return {
    graph: nextGraph,
    nodeId,
    node: updatedNode,
    events: [],
    replanApplied: false,
    timedOut: false,
  };
}

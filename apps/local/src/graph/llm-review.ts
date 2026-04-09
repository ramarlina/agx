import type { ExecutedCheckResult } from './checks';
import type { WorkDispatchResult } from './executor';
import { ReplanTrigger, type ReplanRequest } from './replan';
import type { Edge, ExecutionGraph, GateNode, GraphNode, RootNode, WorkNode } from './types';

export type ReviewDispatcher = (
  node: WorkNode,
  graph: ExecutionGraph,
) => Promise<WorkDispatchResult>;

export interface ReviewerProfile {
  name?: string;
  voice?: string;
  seed?: string;
}

/**
 * Fetches the git diff for the current working directory.
 */
export async function getGitDiff(cwd?: string): Promise<string> {
  const { execSync } = await import('node:child_process');
  const options = { cwd, encoding: 'utf-8' as const, maxBuffer: 512 * 1024 };

  try {
    const diff = execSync('git diff HEAD', options).trim();
    if (diff) return diff;
  } catch {
    // repo might have no commits yet
  }

  try {
    const diff = execSync('git diff --cached', options).trim();
    if (diff) return diff;
  } catch {
    // ignore
  }

  return '';
}

export function findRootNode(graph: ExecutionGraph): RootNode | undefined {
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'root') return node as RootNode;
  }
  return undefined;
}

/**
 * Build a synthetic WorkNode for the daemon to review changes against the objective.
 */
export function buildReviewWorkNode(
  root: RootNode,
  diff: string,
  gateId: string,
  reviewer?: ReviewerProfile,
): WorkNode {
  const criteriaSection = root.criteria?.length
    ? `\n\nAcceptance Criteria:\n${root.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '';

  const diffPreview = diff.length > 30_000
    ? diff.slice(0, 30_000) + '\n\n... (diff truncated)'
    : diff;

  const reviewerContext = [
    reviewer?.name?.trim() ? `Reviewer: ${reviewer.name.trim()}` : null,
    reviewer?.voice?.trim() ? `Voice: ${reviewer.voice.trim()}` : null,
    reviewer?.seed?.trim() ? `Core orientation: ${reviewer.seed.trim()}` : null,
  ].filter(Boolean);

  return {
    type: 'work',
    status: 'pending',
    workType: 'spike',
    title: `Quality gate review: ${root.title}`,
    description: [
      'You are reviewing this change against the task objective.',
      reviewerContext.length > 0
        ? `Preserve the reviewer\'s distinct perspective instead of flattening into generic review language.\n${reviewerContext.join('\n')}`
        : 'Preserve your configured reviewer voice and perspective. Do not flatten into generic review language.',
      '',
      `## Task Objective`,
      root.objective,
      criteriaSection,
      '',
      '## Code Changes (git diff)',
      '```diff',
      diffPreview,
      '```',
      '',
      'Respond with your decision:',
      '- If the changes satisfy the objective, mark this task as done with output: {"passed": true, "reasoning": "..."}',
      '- If the changes do NOT satisfy the objective, mark this task as failed with output: {"passed": false, "reasoning": "..."}',
      '',
      'Be pragmatic: if the changes clearly address the objective, pass it. Only fail if the changes are clearly incomplete, wrong, or unrelated.',
    ].join('\n'),
    acceptanceCriteria: root.criteria,
    deps: [],
    attempts: 0,
    maxAttempts: 1,
    retryPolicy: { backoffMs: 0, onExhaust: 'fail' },
    stage: 'review',
    planNodeKey: `${gateId}:llm-review`,
  };
}

/**
 * Dispatch LLM review to the daemon and convert the result to a check result.
 */
export async function dispatchLlmReview(
  graph: ExecutionGraph,
  gateId: string,
  dispatcher: ReviewDispatcher,
  cwd?: string,
  reviewer?: ReviewerProfile,
): Promise<ExecutedCheckResult> {
  const root = findRootNode(graph);
  if (!root) {
    return makeSkipResult('LLM review skipped: no root node found');
  }

  const diff = await getGitDiff(cwd);
  if (!diff) {
    return makeSkipResult('LLM review skipped: no changes detected');
  }

  const reviewNode = buildReviewWorkNode(root, diff, gateId, reviewer);
  const result = await dispatcher(reviewNode, graph);

  if (result.status === 'success') {
    const output = result.output as { passed?: boolean; reasoning?: string } | undefined;
    const passed = output?.passed !== false; // default to pass if no explicit fail
    return {
      check: 'llm_review',
      passed,
      message: output?.reasoning ?? 'Review completed by agent',
      details: output ? { agentOutput: output } : undefined,
      required: true,
      command: 'daemon:llm_review',
      timeoutMs: 120_000,
      timedOut: false,
      exitCode: passed ? 0 : 1,
    };
  }

  return {
    check: 'llm_review',
    passed: false,
    message: result.status === 'failure'
      ? `Agent review failed: ${result.message ?? 'unknown error'}`
      : `Agent review blocked: ${result.message ?? 'unknown reason'}`,
    required: true,
    command: 'daemon:llm_review',
    timeoutMs: 120_000,
    timedOut: false,
    exitCode: 1,
  };
}

/**
 * Build a ReplanRequest that adds fix work nodes + a new quality gate
 * based on LLM review feedback.
 */
export function buildReplanFromFeedback(
  graph: ExecutionGraph,
  failedGateId: string,
  feedback: string,
): ReplanRequest {
  const root = findRootNode(graph);
  const version = graph.graphVersion;
  const fixNodeId = `fix-from-review-v${version}`;
  const newGateId = `quality-gate-v${version + 1}`;

  // Use empty deps so addNodes doesn't create default on_success edges.
  // We add an explicit on_failure edge from the failed gate to the fix node.
  const fixNode: WorkNode = {
    type: 'work',
    status: 'pending',
    workType: 'implementation',
    title: `Fix issues from quality review (v${version})`,
    description: [
      'The quality gate review found issues with the current changes.',
      '',
      '## Review Feedback',
      feedback,
      '',
      root ? `## Original Objective\n${root.objective}` : '',
      '',
      'Address the feedback above and fix the issues identified by the reviewer.',
    ].join('\n'),
    acceptanceCriteria: ['Address all issues raised in the review feedback'],
    deps: [],
    attempts: 0,
    maxAttempts: 3,
    retryPolicy: { backoffMs: 1000, onExhaust: 'fail' },
    stage: 'fix',
  };

  const newGate: GateNode = {
    type: 'gate',
    status: 'pending',
    gateType: 'quality_gate',
    required: true,
    verificationStrategy: {
      type: 'auto',
      checks: [],
      timeout: 300_000,
    },
    deps: [fixNodeId],
  };

  const addNodes: Record<string, GraphNode> = {
    [fixNodeId]: fixNode,
    [newGateId]: newGate,
  };

  // on_failure edge: fix node activates when the gate fails
  const addEdges: Edge[] = [
    { from: failedGateId, to: fixNodeId, type: 'hard', condition: 'on_failure' },
  ];

  return {
    trigger: ReplanTrigger.GATE_FAILURE,
    triggeredAtNodeId: failedGateId,
    reason: `Quality gate LLM review failed: ${feedback.slice(0, 200)}`,
    triggeredBy: 'agent',
    addNodes,
    addEdges,
  };
}

function makeSkipResult(message: string): ExecutedCheckResult {
  return {
    check: 'llm_review',
    passed: true,
    message,
    required: true,
    command: 'daemon:llm_review',
    timeoutMs: 0,
    timedOut: false,
    exitCode: 0,
  };
}

import {
  didRequiredChecksPass,
  executeChecks,
  type ExecutedCheckResult,
  type RunChecksOptions,
} from './checks';
import {
  dispatchLlmReview,
  type ReviewDispatcher,
} from './llm-review';
import { transitionGateNode } from './state-machine';
import type {
  BudgetConsumedEvent,
  CheckResult,
  ExecutionGraph,
  ExecutionPolicy,
  GateNode,
  GateType,
  GateVerificationEvent,
  RuntimeEvent,
  VerificationResult,
} from './types';

export type HumanDecision = 'approve' | 'reject';
export type VerificationEscalationReason = 'verify_budget_exhausted';

interface GateBehavior {
  defaultChecks: string[];
  humanRequirement: 'never' | 'optional' | 'often' | 'always';
}

const QUALITY_GATE_CHECKS = ['tests_pass', 'lint_clean', 'coverage_threshold'] as const;
const HANDOFF_GATE_CHECKS = [
  'tests_pass',
  'lint_clean',
  'coverage_threshold',
  'build_success',
  'types_valid',
] as const;

const GATE_TYPE_BEHAVIORS: Record<GateType, GateBehavior> = {
  progress: {
    defaultChecks: [],
    humanRequirement: 'never',
  },
  quality_gate: {
    defaultChecks: [...QUALITY_GATE_CHECKS],
    humanRequirement: 'optional',
  },
  design_gate: {
    // Proxy checks for design artifacts until dedicated doc/contract checks land.
    defaultChecks: ['build_success', 'types_valid'],
    humanRequirement: 'often',
  },
  handoff_gate: {
    defaultChecks: [...HANDOFF_GATE_CHECKS],
    humanRequirement: 'always',
  },
  approval_gate: {
    defaultChecks: [],
    humanRequirement: 'always',
  },
};

export interface VerifyGateOptions extends RunChecksOptions {
  gateId: string;
  gate: GateNode;
  policy: ExecutionPolicy;
  depsSatisfied?: boolean;
  now?: string;
  humanDecision?: HumanDecision;
  /** Graph context for LLM review (to access root node objective) */
  graph?: ExecutionGraph;
  /** Dispatcher to send review work to the daemon agent */
  dispatchReview?: ReviewDispatcher;
}

export interface GateVerificationOutcome {
  gate: GateNode;
  policy: ExecutionPolicy;
  autoCheckResults: ExecutedCheckResult[];
  awaitingHuman: boolean;
  escalated: boolean;
  escalationReason?: VerificationEscalationReason;
  events: RuntimeEvent[];
  /** Set when the LLM review specifically failed - triggers replan instead of hard failure */
  llmReviewFailed?: boolean;
  /** Feedback from the LLM review explaining what needs to change */
  llmReviewFeedback?: string;
}

export class GateVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateVerificationError';
  }
}

function clonePolicy(policy: ExecutionPolicy): ExecutionPolicy {
  return { ...policy };
}

function toTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function applyVerificationResult(
  gate: GateNode,
  verificationResult: VerificationResult,
): GateNode {
  return {
    ...gate,
    verificationResult,
  };
}

function makeGateVerificationEvent(nodeId: string, result: VerificationResult): GateVerificationEvent {
  return {
    eventType: 'gate_verification',
    nodeId,
    timestamp: result.verifiedAt,
    result,
  };
}

function consumeVerifyBudget(
  policy: ExecutionPolicy,
  nodeId: string,
  timestamp: string,
): {
  policy: ExecutionPolicy;
  event: BudgetConsumedEvent;
  exhausted: boolean;
} {
  const remaining = Math.max(0, policy.verifyBudgetRemaining - 1);
  const nextPolicy = {
    ...policy,
    verifyBudgetRemaining: remaining,
  };

  return {
    policy: nextPolicy,
    exhausted: remaining === 0,
    event: {
      eventType: 'budget_consumed',
      budgetType: 'verify',
      remaining,
      timestamp,
      triggerNodeId: nodeId,
    },
  };
}

function resolveAutoChecks(gate: GateNode): string[] {
  if (gate.gateType === 'progress' || gate.gateType === 'approval_gate') {
    return [];
  }

  if (gate.verificationStrategy.checks && gate.verificationStrategy.checks.length > 0) {
    return [...gate.verificationStrategy.checks];
  }
  return [...GATE_TYPE_BEHAVIORS[gate.gateType].defaultChecks];
}

function resolveHumanRequirement(gate: GateNode): boolean {
  const behavior = GATE_TYPE_BEHAVIORS[gate.gateType];

  if (behavior.humanRequirement === 'never') {
    return false;
  }
  if (behavior.humanRequirement === 'always') {
    return true;
  }

  if (behavior.humanRequirement === 'optional') {
    return gate.verificationStrategy.type === 'human' || gate.verificationStrategy.type === 'hybrid';
  }

  return gate.verificationStrategy.type !== 'auto';
}

function buildVerificationResult(
  passed: boolean,
  verifiedBy: VerificationResult['verifiedBy'],
  checks: CheckResult[],
  now: string,
): VerificationResult {
  return {
    passed,
    checks,
    verifiedAt: now,
    verifiedBy,
  };
}

function startGateIfNeeded(gate: GateNode, depsSatisfied: boolean): GateNode {
  if (gate.status === 'pending') {
    return transitionGateNode(gate, { type: 'START', depsSatisfied });
  }

  return gate;
}

function createFailureOutcome(
  gateId: string,
  gate: GateNode,
  policy: ExecutionPolicy,
  checks: ExecutedCheckResult[],
  timestamp: string,
): GateVerificationOutcome {
  const failedGate = applyVerificationResult(
    transitionGateNode(gate, { type: 'AUTO_FAIL' }),
    buildVerificationResult(false, 'agent', checks, timestamp),
  );

  const consumed = consumeVerifyBudget(policy, gateId, timestamp);

  return {
    gate: failedGate,
    policy: consumed.policy,
    autoCheckResults: checks,
    awaitingHuman: false,
    escalated: consumed.exhausted,
    escalationReason: consumed.exhausted ? 'verify_budget_exhausted' : undefined,
    events: [
      makeGateVerificationEvent(gateId, failedGate.verificationResult!),
      consumed.event,
    ],
  };
}

function ensureSupportedStatus(status: GateNode['status']): void {
  if (status === 'passed' || status === 'failed' || status === 'skipped') {
    throw new GateVerificationError(`Cannot verify gate from terminal status '${status}'`);
  }
}

export async function verifyGate(options: VerifyGateOptions): Promise<GateVerificationOutcome> {
  const { gateId } = options;
  const timestamp = toTimestamp(options.now);
  const depsSatisfied = options.depsSatisfied ?? true;
  let gate = startGateIfNeeded(options.gate, depsSatisfied);
  let policy = clonePolicy(options.policy);
  const events: RuntimeEvent[] = [];

  ensureSupportedStatus(gate.status);

  if (gate.gateType === 'progress' && gate.status === 'running') {
    gate = applyVerificationResult(
      transitionGateNode(gate, { type: 'AUTO_PASS', humanRequired: false }),
      buildVerificationResult(true, 'agent', [], timestamp),
    );
    events.push(makeGateVerificationEvent(gateId, gate.verificationResult!));

    return {
      gate,
      policy,
      autoCheckResults: [],
      awaitingHuman: false,
      escalated: false,
      events,
    };
  }

  let autoCheckResults: ExecutedCheckResult[] = [];
  if (gate.status === 'running') {
    const checks = resolveAutoChecks(gate);
    autoCheckResults = await executeChecks(checks, options);

    if (!didRequiredChecksPass(autoCheckResults)) {
      return createFailureOutcome(gateId, gate, policy, autoCheckResults, timestamp);
    }

    // LLM review for quality gates: dispatch to daemon to compare changes against task objective
    if (gate.gateType === 'quality_gate' && options.graph && options.dispatchReview) {
      const llmCheckResult = await dispatchLlmReview(
        options.graph,
        gateId,
        options.dispatchReview,
        options.cwd,
      );
      autoCheckResults.push(llmCheckResult);
      if (!llmCheckResult.passed) {
        // Don't hard-fail: signal llmReviewFailed so executor can replan
        const failedGate = applyVerificationResult(
          transitionGateNode(gate, { type: 'AUTO_FAIL' }),
          buildVerificationResult(false, 'agent', autoCheckResults, timestamp),
        );
        events.push(makeGateVerificationEvent(gateId, failedGate.verificationResult!));
        return {
          gate: failedGate,
          policy,
          autoCheckResults,
          awaitingHuman: false,
          escalated: false,
          events,
          llmReviewFailed: true,
          llmReviewFeedback: llmCheckResult.message ?? 'LLM review failed',
        };
      }
    }

    const humanRequired = resolveHumanRequirement(gate);
    gate = transitionGateNode(gate, { type: 'AUTO_PASS', humanRequired });
    gate = applyVerificationResult(
      gate,
      buildVerificationResult(true, 'agent', autoCheckResults, timestamp),
    );
    events.push(makeGateVerificationEvent(gateId, gate.verificationResult!));

    if (!humanRequired) {
      return {
        gate,
        policy,
        autoCheckResults,
        awaitingHuman: false,
        escalated: false,
        events,
      };
    }
  }

  if (gate.status !== 'awaiting_human') {
    throw new GateVerificationError(
      `Unexpected gate status '${gate.status}' after verification flow`,
    );
  }

  if (options.humanDecision === undefined) {
    return {
      gate,
      policy,
      autoCheckResults,
      awaitingHuman: true,
      escalated: false,
      events,
    };
  }

  if (options.humanDecision === 'approve') {
    gate = transitionGateNode(gate, { type: 'HUMAN_APPROVE' });
    gate = applyVerificationResult(
      gate,
      buildVerificationResult(true, 'human', gate.verificationResult?.checks ?? autoCheckResults, timestamp),
    );
    events.push(makeGateVerificationEvent(gateId, gate.verificationResult!));

    return {
      gate,
      policy,
      autoCheckResults,
      awaitingHuman: false,
      escalated: false,
      events,
    };
  }

  gate = transitionGateNode(gate, { type: 'HUMAN_REJECT' });
  gate = applyVerificationResult(
    gate,
    buildVerificationResult(false, 'human', gate.verificationResult?.checks ?? autoCheckResults, timestamp),
  );

  const consumed = consumeVerifyBudget(policy, gateId, timestamp);
  policy = consumed.policy;
  events.push(makeGateVerificationEvent(gateId, gate.verificationResult!));
  events.push(consumed.event);

  return {
    gate,
    policy,
    autoCheckResults,
    awaitingHuman: false,
    escalated: consumed.exhausted,
    escalationReason: consumed.exhausted ? 'verify_budget_exhausted' : undefined,
    events,
  };
}

/**
 * @jest-environment node
 */

import {
  verifyGate,
  type VerifyGateOptions,
} from '@/src/graph/gate-verifier';
import type { CommandExecutor } from '@/src/graph/checks';
import type { ExecutionPolicy, GateNode } from '@/src/graph/types';

function makeGate(overrides: Partial<GateNode> = {}): GateNode {
  return {
    type: 'gate',
    status: 'pending',
    deps: [],
    gateType: 'quality_gate',
    required: true,
    verificationStrategy: {
      type: 'auto',
    },
    ...overrides,
  };
}

function makePolicy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return {
    replanBudgetRemaining: 3,
    replanBudgetInitial: 3,
    verifyBudgetRemaining: 3,
    verifyBudgetInitial: 3,
    maxConcurrentAutoChecks: 1,
    immutableRequiredGates: true,
    maxConcurrent: 3,
    priorityMode: 'fifo',
    nodeTimeoutMs: 1800000,
    graphTimeoutMs: 86400000,
    ...overrides,
  };
}

function makeExecutor(
  impl: (command: string) => { exitCode: number | null; timedOut?: boolean },
): CommandExecutor {
  return async (command) => {
    const outcome = impl(command);
    return {
      exitCode: outcome.exitCode,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: outcome.timedOut ?? false,
    };
  };
}

async function runVerification(
  overrides: Partial<VerifyGateOptions>,
): ReturnType<typeof verifyGate> {
  return verifyGate({
    gateId: 'gate-1',
    gate: makeGate(),
    policy: makePolicy(),
    executor: makeExecutor(() => ({ exitCode: 0 })),
    ...overrides,
  });
}

describe('gate verifier', () => {
  test('progress gate auto-passes and does not consume verify budget', async () => {
    const executor = jest.fn(makeExecutor(() => ({ exitCode: 0 })));
    const result = await runVerification({
      gate: makeGate({
        gateType: 'progress',
        verificationStrategy: { type: 'auto' },
      }),
      policy: makePolicy({ verifyBudgetRemaining: 2 }),
      executor,
    });

    expect(result.gate.status).toBe('passed');
    expect(result.policy.verifyBudgetRemaining).toBe(2);
    expect(result.autoCheckResults).toHaveLength(0);
    expect(executor).not.toHaveBeenCalled();
  });

  test('quality gate runs auto-checks and passes with no human requirement', async () => {
    const executor = jest.fn(makeExecutor(() => ({ exitCode: 0 })));
    const result = await runVerification({
      gate: makeGate({
        gateType: 'quality_gate',
        verificationStrategy: { type: 'auto' },
      }),
      executor,
    });

    expect(result.gate.status).toBe('passed');
    expect(result.awaitingHuman).toBe(false);
    expect(result.policy.verifyBudgetRemaining).toBe(3);
    expect(executor).toHaveBeenCalledTimes(3);
  });

  test('design gate routes to awaiting_human after auto-check pass', async () => {
    const executor = jest.fn(makeExecutor(() => ({ exitCode: 0 })));
    const result = await runVerification({
      gate: makeGate({
        gateType: 'design_gate',
        verificationStrategy: { type: 'hybrid' },
      }),
      executor,
    });

    expect(result.gate.status).toBe('awaiting_human');
    expect(result.awaitingHuman).toBe(true);
    expect(result.policy.verifyBudgetRemaining).toBe(3);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  test('handoff gate always requires human and can be approved', async () => {
    const executor = jest.fn(makeExecutor(() => ({ exitCode: 0 })));
    const firstPass = await runVerification({
      gate: makeGate({
        gateType: 'handoff_gate',
        verificationStrategy: { type: 'human' },
      }),
      executor,
    });

    expect(firstPass.gate.status).toBe('awaiting_human');
    expect(firstPass.awaitingHuman).toBe(true);

    const approved = await runVerification({
      gate: firstPass.gate,
      policy: firstPass.policy,
      humanDecision: 'approve',
      executor,
    });

    expect(approved.gate.status).toBe('passed');
    expect(approved.policy.verifyBudgetRemaining).toBe(3);
  });

  test('approval gate has no auto-checks and consumes budget on human rejection', async () => {
    const executor = jest.fn(makeExecutor(() => ({ exitCode: 0 })));
    const awaiting = await runVerification({
      gate: makeGate({
        gateType: 'approval_gate',
        verificationStrategy: { type: 'human' },
      }),
      policy: makePolicy({ verifyBudgetRemaining: 2 }),
      executor,
    });

    expect(awaiting.gate.status).toBe('awaiting_human');
    expect(executor).not.toHaveBeenCalled();

    const rejected = await runVerification({
      gate: awaiting.gate,
      policy: awaiting.policy,
      humanDecision: 'reject',
      executor,
    });

    expect(rejected.gate.status).toBe('failed');
    expect(rejected.policy.verifyBudgetRemaining).toBe(1);
    expect(rejected.escalated).toBe(false);
  });

  test('auto-check failure decrements verify budget and escalates at exhaustion', async () => {
    const failingExecutor = makeExecutor((command) => ({
      exitCode: command === 'npm test' ? 1 : 0,
    }));

    const nonExhausted = await runVerification({
      gate: makeGate({
        gateType: 'quality_gate',
        verificationStrategy: { type: 'auto' },
      }),
      policy: makePolicy({ verifyBudgetRemaining: 2 }),
      executor: failingExecutor,
    });

    expect(nonExhausted.gate.status).toBe('failed');
    expect(nonExhausted.policy.verifyBudgetRemaining).toBe(1);
    expect(nonExhausted.escalated).toBe(false);

    const exhausted = await runVerification({
      gate: makeGate({
        gateType: 'quality_gate',
        verificationStrategy: { type: 'auto' },
      }),
      policy: makePolicy({ verifyBudgetRemaining: 1 }),
      executor: failingExecutor,
    });

    expect(exhausted.gate.status).toBe('failed');
    expect(exhausted.policy.verifyBudgetRemaining).toBe(0);
    expect(exhausted.escalated).toBe(true);
    expect(exhausted.escalationReason).toBe('verify_budget_exhausted');
  });
});

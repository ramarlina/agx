import { NODE_TIMEOUT_DEFAULT_MS, GRAPH_TIMEOUT_DEFAULT_MS } from "@/lib/constants/timing";
import type {
  ExecutionPolicy,
  FailureNodeStatus,
  IncompleteForDoneStatus,
  SoftDepSatisfiedStatus,
  SuccessNodeStatus,
  TerminalNodeStatus,
} from './types';

export const TERMINAL_NODE_STATUSES = ['done', 'passed', 'failed', 'skipped'] as const satisfies readonly TerminalNodeStatus[];
export const SUCCESS_NODE_STATUSES = ['done', 'passed'] as const satisfies readonly SuccessNodeStatus[];
export const FAILURE_NODE_STATUSES = ['failed'] as const satisfies readonly FailureNodeStatus[];
export const SOFT_DEP_SATISFIED_STATUSES = ['done', 'passed', 'failed', 'skipped', 'blocked'] as const satisfies readonly SoftDepSatisfiedStatus[];
export const INCOMPLETE_FOR_DONE_STATUSES = ['pending', 'running', 'awaiting_human', 'blocked'] as const satisfies readonly IncompleteForDoneStatus[];

export const DEFAULT_EXECUTION_POLICY: Readonly<ExecutionPolicy> = {
  replanBudgetRemaining: 3,
  replanBudgetInitial: 3,
  verifyBudgetRemaining: 5,
  verifyBudgetInitial: 5,
  maxConcurrentAutoChecks: 1,
  immutableRequiredGates: true,
  maxConcurrent: 3,
  priorityMode: 'fifo',
  nodeTimeoutMs: NODE_TIMEOUT_DEFAULT_MS,
  graphTimeoutMs: GRAPH_TIMEOUT_DEFAULT_MS,
};

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Assert<T extends true> = T;

type _TerminalNodeStatusExhaustive = Assert<
  IsEqual<(typeof TERMINAL_NODE_STATUSES)[number], TerminalNodeStatus>
>;
type _SuccessNodeStatusExhaustive = Assert<
  IsEqual<(typeof SUCCESS_NODE_STATUSES)[number], SuccessNodeStatus>
>;
type _FailureNodeStatusExhaustive = Assert<
  IsEqual<(typeof FAILURE_NODE_STATUSES)[number], FailureNodeStatus>
>;
type _SoftDepSatisfiedStatusExhaustive = Assert<
  IsEqual<(typeof SOFT_DEP_SATISFIED_STATUSES)[number], SoftDepSatisfiedStatus>
>;
type _IncompleteForDoneStatusExhaustive = Assert<
  IsEqual<(typeof INCOMPLETE_FOR_DONE_STATUSES)[number], IncompleteForDoneStatus>
>;

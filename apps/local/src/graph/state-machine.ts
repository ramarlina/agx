import { assign, setup, transition as xstateTransition } from "xstate";

import { SUCCESS_NODE_STATUSES, TERMINAL_NODE_STATUSES } from "./constants";
import type {
  ConditionalNode,
  EdgeType,
  ForkNode,
  FunctionNode,
  GateNode,
  GraphNode,
  JoinNode,
  NodeStatus,
  NodeType,
  WorkNode,
} from "./types";

const SUCCESS_STATUS_SET = new Set<NodeStatus>(SUCCESS_NODE_STATUSES);
const TERMINAL_STATUS_SET = new Set<NodeStatus>(TERMINAL_NODE_STATUSES);

const toTransitionKey = (from: NodeStatus, to: NodeStatus) => `${from}->${to}`;

const VALID_NODE_TRANSITIONS: Record<NodeType, Set<string>> = {
  work: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("pending", "skipped"),
    toTransitionKey("running", "done"),
    toTransitionKey("running", "pending"),
    toTransitionKey("running", "failed"),
    toTransitionKey("running", "blocked"),
    toTransitionKey("running", "skipped"),
    // Pause/stop transitions
    toTransitionKey("running", "paused"),
    toTransitionKey("running", "stopped"),
    toTransitionKey("paused", "running"),
    toTransitionKey("paused", "stopped"),
    toTransitionKey("stopped", "running"),
    toTransitionKey("stopped", "pending"),
    // Failed retry
    toTransitionKey("failed", "running"),
    toTransitionKey("failed", "pending"),
    // Manual rerun of completed work (used for re-planning)
    toTransitionKey("done", "pending"),
    // Blocked override (force re-run)
    toTransitionKey("blocked", "pending"),
  ]),
  gate: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("pending", "skipped"),
    toTransitionKey("running", "passed"),
    toTransitionKey("running", "failed"),
    toTransitionKey("running", "awaiting_human"),
    toTransitionKey("awaiting_human", "passed"),
    toTransitionKey("awaiting_human", "failed"),
    // Pause/stop transitions
    toTransitionKey("running", "paused"),
    toTransitionKey("running", "stopped"),
    toTransitionKey("paused", "running"),
    toTransitionKey("paused", "stopped"),
    toTransitionKey("stopped", "running"),
  ]),
  fork: new Set<string>([
    toTransitionKey("pending", "done"),
    toTransitionKey("pending", "skipped"),
  ]),
  join: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("pending", "skipped"),
    toTransitionKey("running", "done"),
    toTransitionKey("running", "failed"),
    // Pause/stop transitions
    toTransitionKey("running", "paused"),
    toTransitionKey("running", "stopped"),
    toTransitionKey("paused", "running"),
    toTransitionKey("stopped", "running"),
  ]),
  conditional: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("pending", "skipped"),
    toTransitionKey("running", "done"),
    toTransitionKey("running", "failed"),
    // Pause/stop transitions
    toTransitionKey("running", "paused"),
    toTransitionKey("running", "stopped"),
    toTransitionKey("paused", "running"),
    toTransitionKey("stopped", "running"),
  ]),
  // Function node transitions (deterministic, no agent loop)
  function: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("pending", "skipped"),
    toTransitionKey("running", "done"),
    toTransitionKey("running", "failed"),
  ]),
  // Root node transitions
  root: new Set<string>([
    toTransitionKey("pending", "running"),
    toTransitionKey("running", "done"),
    toTransitionKey("running", "failed"),
    toTransitionKey("running", "paused"),
    toTransitionKey("running", "stopped"),
    toTransitionKey("paused", "running"),
    toTransitionKey("stopped", "running"),
    toTransitionKey("failed", "running"),
    toTransitionKey("done", "pending"),
  ]),
};

export class InvalidNodeTransitionError extends Error {
  constructor(nodeType: NodeType, fromStatus: NodeStatus, toStatus: NodeStatus) {
    super(`Invalid ${nodeType} node transition: ${fromStatus} -> ${toStatus}`);
    this.name = "InvalidNodeTransitionError";
  }
}

export class InvalidNodeEventError extends Error {
  constructor(nodeType: NodeType, currentStatus: NodeStatus, eventType: string) {
    super(`Invalid ${nodeType} node event '${eventType}' from status '${currentStatus}'`);
    this.name = "InvalidNodeEventError";
  }
}

export function isValidNodeStatusTransition(nodeType: NodeType, fromStatus: NodeStatus, toStatus: NodeStatus): boolean {
  if (fromStatus === toStatus) {
    return true;
  }

  return VALID_NODE_TRANSITIONS[nodeType].has(toTransitionKey(fromStatus, toStatus));
}

export function assertValidNodeStatusTransition(nodeType: NodeType, fromStatus: NodeStatus, toStatus: NodeStatus): void {
  if (!isValidNodeStatusTransition(nodeType, fromStatus, toStatus)) {
    throw new InvalidNodeTransitionError(nodeType, fromStatus, toStatus);
  }
}

const isSuccessStatus = (status: NodeStatus): boolean => SUCCESS_STATUS_SET.has(status);
const isTerminalStatus = (status: NodeStatus): boolean => TERMINAL_STATUS_SET.has(status);

const isSoftEdge = (dependency: JoinDependencySnapshot): boolean => dependency.edgeType === "soft";

const isFuturePotentialSuccess = (dependency: JoinDependencySnapshot): boolean => {
  if (dependency.status === "pending" || dependency.status === "running" || dependency.status === "awaiting_human") {
    return true;
  }

  if (dependency.status === "blocked") {
    return !isSoftEdge(dependency);
  }

  return false;
};

export interface JoinDependencySnapshot {
  nodeId: string;
  status: NodeStatus;
  edgeType?: EdgeType;
}

export type WorkNodeTrigger =
  | { type: "START"; depsSatisfied: boolean }
  | { type: "COMPLETE" }
  | { type: "FAIL"; transient: boolean }
  | { type: "BLOCK" }
  | { type: "SKIP" };

export type GateNodeTrigger =
  | { type: "START"; depsSatisfied: boolean }
  | { type: "AUTO_PASS"; humanRequired: boolean }
  | { type: "AUTO_FAIL" }
  | { type: "HUMAN_APPROVE" }
  | { type: "HUMAN_REJECT" }
  | { type: "SKIP" };

export type ForkNodeTrigger =
  | { type: "ACTIVATE"; depsSatisfied: boolean }
  | { type: "SKIP" };

export type JoinNodeTrigger =
  | { type: "EVALUATE"; dependencies: JoinDependencySnapshot[] }
  | { type: "SKIP" };

export type FunctionNodeTrigger =
  | { type: "START"; depsSatisfied: boolean }
  | { type: "COMPLETE" }
  | { type: "FAIL" }
  | { type: "SKIP" };

export type ConditionalNodeTrigger =
  | { type: "START"; depsSatisfied: boolean }
  | { type: "CONDITION_TRUE" }
  | { type: "CONDITION_FALSE" }
  | { type: "CONDITION_ERROR" }
  | { type: "SKIP" };

interface WorkMachineContext {
  node: WorkNode;
}

interface GateMachineContext {
  node: GateNode;
}

interface ForkMachineContext {
  node: ForkNode;
}

interface JoinMachineContext {
  node: JoinNode;
  dependencies: JoinDependencySnapshot[];
}

interface FunctionMachineContext {
  node: FunctionNode;
}

interface ConditionalMachineContext {
  node: ConditionalNode;
}

function evaluateJoinStrategy(node: JoinNode, dependencies: JoinDependencySnapshot[]): {
  satisfied: boolean;
  impossible: boolean;
} {
  if (node.joinStrategy === "all") {
    const hardDependencies = dependencies.filter((dependency) => !isSoftEdge(dependency));
    const softDependencies = dependencies.filter(isSoftEdge);

    const hardFailure = hardDependencies.some((dependency) => dependency.status === "failed");
    if (hardFailure) {
      return { satisfied: false, impossible: true };
    }

    const hardSatisfied = hardDependencies.every(
      (dependency) => dependency.status !== "failed" && isTerminalStatus(dependency.status),
    );
    const softSatisfied = softDependencies.every(
      (dependency) => isTerminalStatus(dependency.status) || dependency.status === "blocked",
    );

    return { satisfied: hardSatisfied && softSatisfied, impossible: false };
  }

  if (node.joinStrategy === "any") {
    const successCount = dependencies.filter((dependency) => isSuccessStatus(dependency.status)).length;
    if (successCount >= 1) {
      return { satisfied: true, impossible: false };
    }

    const futurePotentialCount = dependencies.filter(isFuturePotentialSuccess).length;
    return { satisfied: false, impossible: futurePotentialCount === 0 };
  }

  const requiredCount = node.requiredCount ?? dependencies.length;
  const successCount = dependencies.filter((dependency) => isSuccessStatus(dependency.status)).length;
  if (successCount >= requiredCount) {
    return { satisfied: true, impossible: false };
  }

  const futurePotentialCount = dependencies.filter(isFuturePotentialSuccess).length;
  const maxPossibleSuccessCount = successCount + futurePotentialCount;

  return { satisfied: false, impossible: maxPossibleSuccessCount < requiredCount };
}

const workNodeSetup = setup({
  types: {
    context: {} as WorkMachineContext,
    input: {} as WorkMachineContext,
    events: {} as WorkNodeTrigger,
  },
  guards: {
    depsSatisfied: ({ event }) => event.type === "START" && event.depsSatisfied,
    canRetry: ({ context, event }) =>
      event.type === "FAIL" && event.transient && context.node.attempts < context.node.maxAttempts,
    shouldSkipOnExhaust: ({ context, event }) =>
      event.type === "FAIL" && context.node.attempts >= context.node.maxAttempts && context.node.retryPolicy.onExhaust === "skip",
    shouldFailOnExhaust: ({ context, event }) =>
      event.type === "FAIL" && context.node.attempts >= context.node.maxAttempts && context.node.retryPolicy.onExhaust === "fail",
    shouldEscalateOnExhaust: ({ context, event }) =>
      event.type === "FAIL" && context.node.attempts >= context.node.maxAttempts && context.node.retryPolicy.onExhaust === "escalate",
    fatalFailure: ({ event }) => event.type === "FAIL" && !event.transient,
  },
  actions: {
    markRunning: assign(({ context }) => ({
      node: { ...context.node, status: "running", attempts: context.node.attempts + 1 },
    })),
    markDone: assign(({ context }) => ({ node: { ...context.node, status: "done" } })),
    markPendingRetry: assign(({ context }) => ({ node: { ...context.node, status: "pending" } })),
    markFailed: assign(({ context }) => ({ node: { ...context.node, status: "failed" } })),
    markBlocked: assign(({ context }) => ({ node: { ...context.node, status: "blocked" } })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const workNodeMachine = workNodeSetup.createMachine({
  id: "work-node",
  initial: "pending",
  context: ({ input }) => ({ node: { ...input.node } }),
  states: {
    pending: {
      on: {
        START: {
          target: "running",
          guard: "depsSatisfied",
          actions: "markRunning",
        },
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    running: {
      on: {
        COMPLETE: {
          target: "done",
          actions: "markDone",
        },
        FAIL: [
          {
            target: "pending",
            guard: "canRetry",
            actions: "markPendingRetry",
          },
          {
            target: "skipped",
            guard: "shouldSkipOnExhaust",
            actions: "markSkipped",
          },
          {
            target: "blocked",
            guard: "shouldEscalateOnExhaust",
            actions: "markBlocked",
          },
          {
            target: "failed",
            guard: "shouldFailOnExhaust",
            actions: "markFailed",
          },
          {
            target: "failed",
            guard: "fatalFailure",
            actions: "markFailed",
          },
        ],
        BLOCK: {
          target: "blocked",
          actions: "markBlocked",
        },
      },
    },
    done: {},
    failed: {},
    blocked: {},
    skipped: {},
  },
});

const gateNodeSetup = setup({
  types: {
    context: {} as GateMachineContext,
    input: {} as GateMachineContext,
    events: {} as GateNodeTrigger,
  },
  guards: {
    depsSatisfied: ({ event }) => event.type === "START" && event.depsSatisfied,
    needsHumanReview: ({ event }) => event.type === "AUTO_PASS" && event.humanRequired,
    noHumanReview: ({ event }) => event.type === "AUTO_PASS" && !event.humanRequired,
  },
  actions: {
    markRunning: assign(({ context }) => ({ node: { ...context.node, status: "running" } })),
    markPassed: assign(({ context }) => ({ node: { ...context.node, status: "passed" } })),
    markFailed: assign(({ context }) => ({ node: { ...context.node, status: "failed" } })),
    markAwaitingHuman: assign(({ context }) => ({
      node: { ...context.node, status: "awaiting_human" },
    })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const gateNodeMachine = gateNodeSetup.createMachine({
  id: "gate-node",
  initial: "pending",
  context: ({ input }) => ({ node: { ...input.node } }),
  states: {
    pending: {
      on: {
        START: {
          target: "running",
          guard: "depsSatisfied",
          actions: "markRunning",
        },
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    running: {
      on: {
        AUTO_PASS: [
          {
            target: "awaiting_human",
            guard: "needsHumanReview",
            actions: "markAwaitingHuman",
          },
          {
            target: "passed",
            guard: "noHumanReview",
            actions: "markPassed",
          },
        ],
        AUTO_FAIL: {
          target: "failed",
          actions: "markFailed",
        },
      },
    },
    awaiting_human: {
      on: {
        HUMAN_APPROVE: {
          target: "passed",
          actions: "markPassed",
        },
        HUMAN_REJECT: {
          target: "failed",
          actions: "markFailed",
        },
      },
    },
    passed: {},
    failed: {},
    skipped: {},
  },
});

const forkNodeSetup = setup({
  types: {
    context: {} as ForkMachineContext,
    input: {} as ForkMachineContext,
    events: {} as ForkNodeTrigger,
  },
  guards: {
    depsSatisfied: ({ event }) => event.type === "ACTIVATE" && event.depsSatisfied,
  },
  actions: {
    markDone: assign(({ context }) => ({ node: { ...context.node, status: "done" } })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const forkNodeMachine = forkNodeSetup.createMachine({
  id: "fork-node",
  initial: "pending",
  context: ({ input }) => ({ node: { ...input.node } }),
  states: {
    pending: {
      on: {
        ACTIVATE: {
          target: "done",
          guard: "depsSatisfied",
          actions: "markDone",
        },
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    done: {},
    skipped: {},
  },
});

const joinNodeSetup = setup({
  types: {
    context: {} as JoinMachineContext,
    input: {} as JoinMachineContext,
    events: {} as JoinNodeTrigger,
  },
  guards: {
    hasAnyTerminalDependency: ({ event }) =>
      event.type === "EVALUATE" && event.dependencies.some((dependency) => isTerminalStatus(dependency.status)),
    joinStrategySatisfied: ({ context, event }) =>
      event.type === "EVALUATE" && evaluateJoinStrategy(context.node, event.dependencies).satisfied,
    joinStrategyImpossible: ({ context, event }) =>
      event.type === "EVALUATE" && evaluateJoinStrategy(context.node, event.dependencies).impossible,
  },
  actions: {
    setDependencies: assign(({ context, event }) => ({
      dependencies: event.type === "EVALUATE" ? [...event.dependencies] : context.dependencies,
    })),
    markRunning: assign(({ context }) => ({ node: { ...context.node, status: "running" } })),
    markDone: assign(({ context }) => ({ node: { ...context.node, status: "done" } })),
    markFailed: assign(({ context }) => ({ node: { ...context.node, status: "failed" } })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const joinNodeMachine = joinNodeSetup.createMachine({
  id: "join-node",
  initial: "pending",
  context: ({ input }) => ({
    node: { ...input.node },
    dependencies: [...input.dependencies],
  }),
  states: {
    pending: {
      on: {
        EVALUATE: [
          {
            target: "running",
            guard: "hasAnyTerminalDependency",
            actions: ["setDependencies", "markRunning"],
          },
          {
            actions: "setDependencies",
          },
        ],
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    running: {
      on: {
        EVALUATE: [
          {
            target: "done",
            guard: "joinStrategySatisfied",
            actions: ["setDependencies", "markDone"],
          },
          {
            target: "failed",
            guard: "joinStrategyImpossible",
            actions: ["setDependencies", "markFailed"],
          },
          {
            actions: "setDependencies",
          },
        ],
      },
    },
    done: {},
    failed: {},
    skipped: {},
  },
});

const conditionalNodeSetup = setup({
  types: {
    context: {} as ConditionalMachineContext,
    input: {} as ConditionalMachineContext,
    events: {} as ConditionalNodeTrigger,
  },
  guards: {
    depsSatisfied: ({ event }) => event.type === "START" && event.depsSatisfied,
  },
  actions: {
    markRunning: assign(({ context }) => ({ node: { ...context.node, status: "running" } })),
    markThenDone: assign(({ context }) => ({
      node: { ...context.node, status: "done", evaluatedTo: "then" },
    })),
    markElseDone: assign(({ context }) => ({
      node: { ...context.node, status: "done", evaluatedTo: "else" },
    })),
    markFailed: assign(({ context }) => ({ node: { ...context.node, status: "failed" } })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const conditionalNodeMachine = conditionalNodeSetup.createMachine({
  id: "conditional-node",
  initial: "pending",
  context: ({ input }) => ({ node: { ...input.node } }),
  states: {
    pending: {
      on: {
        START: {
          target: "running",
          guard: "depsSatisfied",
          actions: "markRunning",
        },
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    running: {
      on: {
        CONDITION_TRUE: {
          target: "done",
          actions: "markThenDone",
        },
        CONDITION_FALSE: {
          target: "done",
          actions: "markElseDone",
        },
        CONDITION_ERROR: {
          target: "failed",
          actions: "markFailed",
        },
      },
    },
    done: {},
    failed: {},
    skipped: {},
  },
});

const functionNodeSetup = setup({
  types: {
    context: {} as FunctionMachineContext,
    input: {} as FunctionMachineContext,
    events: {} as FunctionNodeTrigger,
  },
  guards: {
    depsSatisfied: ({ event }) => event.type === "START" && event.depsSatisfied,
  },
  actions: {
    markRunning: assign(({ context }) => ({ node: { ...context.node, status: "running" } })),
    markDone: assign(({ context }) => ({ node: { ...context.node, status: "done" } })),
    markFailed: assign(({ context }) => ({ node: { ...context.node, status: "failed" } })),
    markSkipped: assign(({ context }) => ({ node: { ...context.node, status: "skipped" } })),
  },
});

export const functionNodeMachine = functionNodeSetup.createMachine({
  id: "function-node",
  initial: "pending",
  context: ({ input }) => ({ node: { ...input.node } }),
  states: {
    pending: {
      on: {
        START: {
          target: "running",
          guard: "depsSatisfied",
          actions: "markRunning",
        },
        SKIP: {
          target: "skipped",
          actions: "markSkipped",
        },
      },
    },
    running: {
      on: {
        COMPLETE: {
          target: "done",
          actions: "markDone",
        },
        FAIL: {
          target: "failed",
          actions: "markFailed",
        },
      },
    },
    done: {},
    failed: {},
    skipped: {},
  },
});

function assertEventSupported(
  machine: { getTransitionData: (...args: any[]) => unknown[] }, // eslint-disable-line
  snapshot: unknown,
  event: { type: string },
  nodeType: NodeType,
  currentStatus: NodeStatus,
): void {
  const transitions = machine.getTransitionData(snapshot, event);
  if (transitions.length === 0) {
    throw new InvalidNodeEventError(nodeType, currentStatus, event.type);
  }
}

function assertStatusPair(nodeType: NodeType, beforeStatus: NodeStatus, afterStatus: NodeStatus): void {
  if (beforeStatus !== afterStatus) {
    assertValidNodeStatusTransition(nodeType, beforeStatus, afterStatus);
  }
}

function resolveStatusValue(node: GraphNode): string {
  return node.status;
}

export function transitionWorkNode(node: WorkNode, trigger: WorkNodeTrigger): WorkNode {
  const snapshot = workNodeMachine.resolveState({ value: resolveStatusValue(node), context: { node: { ...node } } });
  assertEventSupported(workNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(workNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);
  return nextNode;
}

export function transitionGateNode(node: GateNode, trigger: GateNodeTrigger): GateNode {
  const snapshot = gateNodeMachine.resolveState({ value: resolveStatusValue(node), context: { node: { ...node } } });
  assertEventSupported(gateNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(gateNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);
  return nextNode;
}

export function transitionForkNode(node: ForkNode, trigger: ForkNodeTrigger): ForkNode {
  const snapshot = forkNodeMachine.resolveState({ value: resolveStatusValue(node), context: { node: { ...node } } });
  assertEventSupported(forkNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(forkNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);
  return nextNode;
}

export function transitionJoinNode(node: JoinNode, trigger: JoinNodeTrigger): JoinNode {
  const dependencies = trigger.type === "EVALUATE" ? trigger.dependencies : [];
  const snapshot = joinNodeMachine.resolveState({
    value: resolveStatusValue(node),
    context: { node: { ...node }, dependencies: [...dependencies] },
  });

  assertEventSupported(joinNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(joinNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);
  return nextNode;
}

export interface ConditionalTransitionResult {
  node: ConditionalNode;
  enabledBranchNodeIds: string[];
  skippedBranchNodeIds: string[];
}

function getConditionalBranchOutcome(node: ConditionalNode): {
  enabledBranchNodeIds: string[];
  skippedBranchNodeIds: string[];
} {
  if (node.status !== "done") {
    return { enabledBranchNodeIds: [], skippedBranchNodeIds: [] };
  }

  if (node.evaluatedTo === "then") {
    return {
      enabledBranchNodeIds: [...node.thenBranch],
      skippedBranchNodeIds: [...node.elseBranch],
    };
  }

  if (node.evaluatedTo === "else") {
    return {
      enabledBranchNodeIds: [...node.elseBranch],
      skippedBranchNodeIds: [...node.thenBranch],
    };
  }

  return { enabledBranchNodeIds: [], skippedBranchNodeIds: [] };
}

export function transitionConditionalNode(
  node: ConditionalNode,
  trigger: ConditionalNodeTrigger,
): ConditionalTransitionResult {
  const snapshot = conditionalNodeMachine.resolveState({
    value: resolveStatusValue(node),
    context: { node: { ...node } },
  });

  assertEventSupported(conditionalNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(conditionalNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);

  return {
    node: nextNode,
    ...getConditionalBranchOutcome(nextNode),
  };
}

export function transitionFunctionNode(node: FunctionNode, trigger: FunctionNodeTrigger): FunctionNode {
  const snapshot = functionNodeMachine.resolveState({ value: resolveStatusValue(node), context: { node: { ...node } } });
  assertEventSupported(functionNodeMachine, snapshot, trigger, node.type, node.status);
  const [nextSnapshot] = xstateTransition(functionNodeMachine, snapshot, trigger);
  const nextNode = nextSnapshot.context.node;
  assertStatusPair(node.type, node.status, nextNode.status);
  return nextNode;
}

export const NODE_STATE_MACHINES = {
  work: workNodeMachine,
  gate: gateNodeMachine,
  fork: forkNodeMachine,
  join: joinNodeMachine,
  conditional: conditionalNodeMachine,
  function: functionNodeMachine,
} as const;

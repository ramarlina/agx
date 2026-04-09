/**
 * @jest-environment node
 */

import { createTestModel } from "@xstate/graph";

import {
  assertValidNodeStatusTransition,
  conditionalNodeMachine,
  forkNodeMachine,
  gateNodeMachine,
  InvalidNodeEventError,
  InvalidNodeTransitionError,
  isValidNodeStatusTransition,
  joinNodeMachine,
  transitionConditionalNode,
  transitionForkNode,
  transitionGateNode,
  transitionJoinNode,
  transitionWorkNode,
  workNodeMachine,
  type JoinDependencySnapshot,
} from "@/src/graph/state-machine";
import type {
  ConditionalNode,
  ForkNode,
  GateNode,
  JoinNode,
  NodeStatus,
  WorkNode,
} from "@/src/graph/types";

function makeWorkNode(overrides: Partial<WorkNode> = {}): WorkNode {
  return {
    type: "work",
    status: "pending",
    deps: [],
    title: "Implement",
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: {
      backoffMs: 1000,
      onExhaust: "fail",
    },
    ...overrides,
  };
}

function makeGateNode(overrides: Partial<GateNode> = {}): GateNode {
  return {
    type: "gate",
    status: "pending",
    deps: [],
    gateType: "quality_gate",
    required: true,
    verificationStrategy: {
      type: "auto",
      checks: ["tests"],
    },
    ...overrides,
  };
}

function makeForkNode(overrides: Partial<ForkNode> = {}): ForkNode {
  return {
    type: "fork",
    status: "pending",
    deps: [],
    ...overrides,
  };
}

function makeJoinNode(overrides: Partial<JoinNode> = {}): JoinNode {
  return {
    type: "join",
    status: "pending",
    deps: ["a", "b"],
    joinStrategy: "all",
    ...overrides,
  };
}

function makeConditionalNode(overrides: Partial<ConditionalNode> = {}): ConditionalNode {
  return {
    type: "conditional",
    status: "pending",
    deps: [],
    condition: {
      expression: "ctx.input.hasTests == true",
      inputFrom: "build",
    },
    thenBranch: ["then-1", "then-2"],
    elseBranch: ["else-1"],
    ...overrides,
  };
}

function hard(nodeId: string, status: NodeStatus): JoinDependencySnapshot {
  return { nodeId, status, edgeType: "hard" };
}

function soft(nodeId: string, status: NodeStatus): JoinDependencySnapshot {
  return { nodeId, status, edgeType: "soft" };
}

function collectStateTransitions(paths: Array<{ steps: Array<{ state: { value: unknown } }> }>, initial: string): Set<string> {
  const transitions = new Set<string>();

  for (const path of paths) {
    let previous = initial;
    for (const step of path.steps) {
      const next = String(step.state.value);
      if (previous !== next) {
        transitions.add(`${previous}->${next}`);
      }
      previous = next;
    }
  }

  return transitions;
}

function expectTransitionsToInclude(transitions: Set<string>, expectedTransitions: string[]): void {
  for (const expectedTransition of expectedTransitions) {
    expect(transitions.has(expectedTransition)).toBe(true);
  }
}

describe("graph node state machines", () => {
  describe("WorkNode", () => {
    test("pending -> running when deps are satisfied", () => {
      const node = makeWorkNode();
      const next = transitionWorkNode(node, { type: "START", depsSatisfied: true });

      expect(next.status).toBe("running");
      expect(next.attempts).toBe(1);
    });

    test("running -> done on success", () => {
      const node = makeWorkNode({ status: "running", attempts: 1 });
      const next = transitionWorkNode(node, { type: "COMPLETE" });

      expect(next.status).toBe("done");
    });

    test("running -> pending on transient failure before max attempts", () => {
      const node = makeWorkNode({ status: "running", attempts: 1, maxAttempts: 3 });
      const next = transitionWorkNode(node, { type: "FAIL", transient: true });

      expect(next.status).toBe("pending");
    });

    test("running -> failed on exhausted retries when policy is fail", () => {
      const node = makeWorkNode({
        status: "running",
        attempts: 2,
        maxAttempts: 2,
        retryPolicy: { backoffMs: 1000, onExhaust: "fail" },
      });
      const next = transitionWorkNode(node, { type: "FAIL", transient: true });

      expect(next.status).toBe("failed");
    });

    test("running -> skipped on exhausted retries when policy is skip", () => {
      const node = makeWorkNode({
        status: "running",
        attempts: 2,
        maxAttempts: 2,
        retryPolicy: { backoffMs: 1000, onExhaust: "skip" },
      });
      const next = transitionWorkNode(node, { type: "FAIL", transient: true });

      expect(next.status).toBe("skipped");
    });

    test("running -> blocked when explicitly blocked", () => {
      const node = makeWorkNode({ status: "running", attempts: 1 });
      const next = transitionWorkNode(node, { type: "BLOCK" });

      expect(next.status).toBe("blocked");
    });

    test("pending -> skipped when branch is not taken", () => {
      const node = makeWorkNode();
      const next = transitionWorkNode(node, { type: "SKIP" });

      expect(next.status).toBe("skipped");
    });

    test("throws on invalid event from current state", () => {
      const node = makeWorkNode({ status: "pending" });

      expect(() => transitionWorkNode(node, { type: "COMPLETE" })).toThrow(InvalidNodeEventError);
    });
  });

  describe("GateNode", () => {
    test("pending -> running when deps are satisfied", () => {
      const node = makeGateNode();
      const next = transitionGateNode(node, { type: "START", depsSatisfied: true });

      expect(next.status).toBe("running");
    });

    test("running -> passed when auto checks pass with no human requirement", () => {
      const node = makeGateNode({ status: "running" });
      const next = transitionGateNode(node, { type: "AUTO_PASS", humanRequired: false });

      expect(next.status).toBe("passed");
    });

    test("running -> awaiting_human when auto checks pass with human requirement", () => {
      const node = makeGateNode({ status: "running" });
      const next = transitionGateNode(node, { type: "AUTO_PASS", humanRequired: true });

      expect(next.status).toBe("awaiting_human");
    });

    test("running -> failed when auto checks fail", () => {
      const node = makeGateNode({ status: "running" });
      const next = transitionGateNode(node, { type: "AUTO_FAIL" });

      expect(next.status).toBe("failed");
    });

    test("awaiting_human -> passed on human approval", () => {
      const node = makeGateNode({ status: "awaiting_human" });
      const next = transitionGateNode(node, { type: "HUMAN_APPROVE" });

      expect(next.status).toBe("passed");
    });

    test("awaiting_human -> failed on human rejection", () => {
      const node = makeGateNode({ status: "awaiting_human" });
      const next = transitionGateNode(node, { type: "HUMAN_REJECT" });

      expect(next.status).toBe("failed");
    });

    test("throws on invalid event from current state", () => {
      const node = makeGateNode({ status: "pending" });

      expect(() => transitionGateNode(node, { type: "HUMAN_APPROVE" })).toThrow(InvalidNodeEventError);
    });
  });

  describe("ForkNode", () => {
    test("pending -> done when deps are satisfied", () => {
      const node = makeForkNode();
      const next = transitionForkNode(node, { type: "ACTIVATE", depsSatisfied: true });

      expect(next.status).toBe("done");
    });

    test("throws on invalid event from current state", () => {
      const node = makeForkNode({ status: "done" });

      expect(() => transitionForkNode(node, { type: "ACTIVATE", depsSatisfied: true })).toThrow(InvalidNodeEventError);
    });
  });

  describe("JoinNode", () => {
    test("pending -> running when any dependency reaches terminal status", () => {
      const node = makeJoinNode({ status: "pending", joinStrategy: "all" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "pending")],
      });

      expect(next.status).toBe("running");
    });

    test("running -> done for all strategy with skipped deps and soft blocked deps", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "all" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "skipped"), soft("c", "blocked")],
      });

      expect(next.status).toBe("done");
    });

    test("running -> failed for all strategy when any hard dependency fails", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "all" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "failed"), hard("b", "done")],
      });

      expect(next.status).toBe("failed");
    });

    test("running stays running for all strategy when completion is still possible", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "all" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "running")],
      });

      expect(next.status).toBe("running");
    });

    test("running -> done for any strategy when at least one dependency succeeds", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "any" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "failed"), hard("b", "passed")],
      });

      expect(next.status).toBe("done");
    });

    test("running -> failed for any strategy when success is impossible", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "any" });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "failed"), hard("b", "skipped"), soft("c", "blocked")],
      });

      expect(next.status).toBe("failed");
    });

    test("running -> done for n_of_m when required successes are met", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "n_of_m", requiredCount: 2 });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "passed"), hard("c", "skipped")],
      });

      expect(next.status).toBe("done");
    });

    test("running -> failed for n_of_m when threshold becomes impossible", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "n_of_m", requiredCount: 2 });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "failed"), hard("c", "skipped")],
      });

      expect(next.status).toBe("failed");
    });

    test("running stays running for n_of_m when threshold is not yet met but still possible", () => {
      const node = makeJoinNode({ status: "running", joinStrategy: "n_of_m", requiredCount: 2 });
      const next = transitionJoinNode(node, {
        type: "EVALUATE",
        dependencies: [hard("a", "done"), hard("b", "pending"), hard("c", "skipped")],
      });

      expect(next.status).toBe("running");
    });
  });

  describe("ConditionalNode", () => {
    test("pending -> running when deps are satisfied", () => {
      const node = makeConditionalNode();
      const result = transitionConditionalNode(node, { type: "START", depsSatisfied: true });

      expect(result.node.status).toBe("running");
      expect(result.enabledBranchNodeIds).toEqual([]);
      expect(result.skippedBranchNodeIds).toEqual([]);
    });

    test("running -> done when condition evaluates true, enabling then branch", () => {
      const node = makeConditionalNode({ status: "running" });
      const result = transitionConditionalNode(node, { type: "CONDITION_TRUE" });

      expect(result.node.status).toBe("done");
      expect(result.node.evaluatedTo).toBe("then");
      expect(result.enabledBranchNodeIds).toEqual(["then-1", "then-2"]);
      expect(result.skippedBranchNodeIds).toEqual(["else-1"]);
    });

    test("running -> done when condition evaluates false, enabling else branch", () => {
      const node = makeConditionalNode({ status: "running" });
      const result = transitionConditionalNode(node, { type: "CONDITION_FALSE" });

      expect(result.node.status).toBe("done");
      expect(result.node.evaluatedTo).toBe("else");
      expect(result.enabledBranchNodeIds).toEqual(["else-1"]);
      expect(result.skippedBranchNodeIds).toEqual(["then-1", "then-2"]);
    });

    test("running -> failed when expression evaluation errors", () => {
      const node = makeConditionalNode({ status: "running" });
      const result = transitionConditionalNode(node, { type: "CONDITION_ERROR" });

      expect(result.node.status).toBe("failed");
    });

    test("throws on invalid event from current state", () => {
      const node = makeConditionalNode({ status: "pending" });

      expect(() => transitionConditionalNode(node, { type: "CONDITION_TRUE" })).toThrow(InvalidNodeEventError);
    });
  });

  describe("transition guard", () => {
    test("recognizes valid from->to pairs", () => {
      expect(isValidNodeStatusTransition("work", "pending", "running")).toBe(true);
      expect(isValidNodeStatusTransition("work", "done", "pending")).toBe(true);
      expect(isValidNodeStatusTransition("gate", "awaiting_human", "passed")).toBe(true);
      expect(isValidNodeStatusTransition("join", "running", "done")).toBe(true);
    });

    test("rejects invalid from->to pairs", () => {
      expect(isValidNodeStatusTransition("fork", "done", "pending")).toBe(false);
      expect(() => assertValidNodeStatusTransition("fork", "done", "pending")).toThrow(InvalidNodeTransitionError);
    });
  });

  describe("@xstate/graph traversal", () => {
    test("covers WorkNode graph transitions", () => {
      const model = createTestModel(workNodeMachine);
      const failPolicyPaths = model.getSimplePaths({
        input: { node: makeWorkNode({ maxAttempts: 2, retryPolicy: { backoffMs: 1000, onExhaust: "fail" } }) },
        events: [
          { type: "START", depsSatisfied: true },
          { type: "START", depsSatisfied: false },
          { type: "COMPLETE" },
          { type: "FAIL", transient: true },
          { type: "FAIL", transient: false },
          { type: "BLOCK" },
          { type: "SKIP" },
        ],
      });
      const skipPolicyPaths = model.getSimplePaths({
        input: { node: makeWorkNode({ maxAttempts: 1, retryPolicy: { backoffMs: 1000, onExhaust: "skip" } }) },
        events: [
          { type: "START", depsSatisfied: true },
          { type: "FAIL", transient: true },
          { type: "SKIP" },
        ],
      });

      const transitions = new Set([
        ...collectStateTransitions(failPolicyPaths, "pending"),
        ...collectStateTransitions(skipPolicyPaths, "pending"),
      ]);

      expectTransitionsToInclude(transitions, [
        "pending->running",
        "running->done",
        "running->pending",
        "running->failed",
        "running->blocked",
        "pending->skipped",
        "running->skipped",
      ]);
    });

    test("covers GateNode graph transitions", () => {
      const model = createTestModel(gateNodeMachine);
      const paths = model.getSimplePaths({
        input: { node: makeGateNode() },
        events: [
          { type: "START", depsSatisfied: true },
          { type: "START", depsSatisfied: false },
          { type: "AUTO_PASS", humanRequired: false },
          { type: "AUTO_PASS", humanRequired: true },
          { type: "AUTO_FAIL" },
          { type: "HUMAN_APPROVE" },
          { type: "HUMAN_REJECT" },
          { type: "SKIP" },
        ],
      });

      const transitions = collectStateTransitions(paths, "pending");

      expectTransitionsToInclude(transitions, [
        "pending->running",
        "running->passed",
        "running->failed",
        "running->awaiting_human",
        "awaiting_human->passed",
        "awaiting_human->failed",
      ]);
    });

    test("covers ForkNode graph transitions", () => {
      const model = createTestModel(forkNodeMachine);
      const paths = model.getSimplePaths({
        input: { node: makeForkNode() },
        events: [
          { type: "ACTIVATE", depsSatisfied: true },
          { type: "ACTIVATE", depsSatisfied: false },
          { type: "SKIP" },
        ],
      });

      const transitions = collectStateTransitions(paths, "pending");

      expect(transitions.has("pending->done")).toBe(true);
    });

    test("covers JoinNode graph transitions", () => {
      const model = createTestModel(joinNodeMachine);
      const paths = model.getSimplePaths({
        input: {
          node: makeJoinNode({ joinStrategy: "all" }),
          dependencies: [hard("a", "pending"), hard("b", "pending")],
        },
        events: [
          { type: "EVALUATE", dependencies: [hard("a", "pending"), hard("b", "pending")] },
          { type: "EVALUATE", dependencies: [hard("a", "done"), hard("b", "pending")] },
          { type: "EVALUATE", dependencies: [hard("a", "done"), hard("b", "skipped")] },
          { type: "EVALUATE", dependencies: [hard("a", "failed"), hard("b", "done")] },
          { type: "SKIP" },
        ],
      });

      const transitions = collectStateTransitions(paths, "pending");

      expectTransitionsToInclude(transitions, ["pending->running", "running->done", "running->failed"]);
    });

    test("covers ConditionalNode graph transitions", () => {
      const model = createTestModel(conditionalNodeMachine);
      const paths = model.getSimplePaths({
        input: { node: makeConditionalNode() },
        events: [
          { type: "START", depsSatisfied: true },
          { type: "START", depsSatisfied: false },
          { type: "CONDITION_TRUE" },
          { type: "CONDITION_FALSE" },
          { type: "CONDITION_ERROR" },
          { type: "SKIP" },
        ],
      });

      const transitions = collectStateTransitions(paths, "pending");

      expectTransitionsToInclude(transitions, ["pending->running", "running->done", "running->failed"]);
    });
  });
});

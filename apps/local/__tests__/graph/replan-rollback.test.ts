/**
 * @jest-environment node
 */

import { DEFAULT_EXECUTION_POLICY } from "@/src/graph/constants";
import {
  applyReplan,
  InvalidReplanPointError,
  ReplanBudgetExceededError,
  ReplanConstraintViolationError,
  ReplanTrigger,
} from "@/src/graph/replan";
import { rollbackToCheckpoint } from "@/src/graph/rollback";
import type { Edge, ExecutionGraph, GateNode, GraphNode, WorkNode } from "@/src/graph/types";

function workNode(
  title: string,
  deps: string[] = [],
  overrides: Partial<WorkNode> = {},
): WorkNode {
  return {
    type: "work",
    status: "pending",
    deps,
    title,
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: { backoffMs: 1_000, onExhaust: "fail" },
    ...overrides,
  };
}

function gateNode(
  gateType: GateNode["gateType"],
  deps: string[] = [],
  required = false,
  overrides: Partial<GateNode> = {},
): GateNode {
  return {
    type: "gate",
    status: "pending",
    deps,
    gateType,
    required,
    verificationStrategy: { type: "auto" },
    ...overrides,
  };
}

function makeGraph(
  nodes: Record<string, GraphNode>,
  edges: Edge[],
  overrides: Partial<ExecutionGraph> = {},
): ExecutionGraph {
  return {
    id: "graph-1",
    taskId: "task-1",
    graphVersion: 2,
    mode: "PROJECT",
    nodes,
    edges,
    policy: { ...DEFAULT_EXECUTION_POLICY, replanBudgetRemaining: 2 },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["handoff-gate"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-02-14T00:00:00.000Z",
    ...overrides,
  };
}

function makeCheckpointGraph(): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    start: workNode("start"),
    impl: workNode("impl", ["start"], { status: "done", attempts: 1 }),
    "progress-gate": gateNode("progress", ["impl"], false, { status: "pending" }),
    tests: workNode("tests", ["progress-gate"], { status: "pending" }),
    "quality-gate": gateNode("quality_gate", ["tests"], true, { status: "failed" }),
    "handoff-gate": gateNode("handoff_gate", ["quality-gate"], true, { status: "pending" }),
  };

  const edges: Edge[] = [
    { from: "start", to: "impl", type: "hard" },
    { from: "impl", to: "progress-gate", type: "hard" },
    { from: "progress-gate", to: "tests", type: "hard" },
    { from: "tests", to: "quality-gate", type: "hard" },
    { from: "quality-gate", to: "handoff-gate", type: "hard" },
  ];

  return makeGraph(nodes, edges);
}

function makeExhaustedNoCheckpointGraph(): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    exhausted: workNode("exhausted", [], {
      status: "failed",
      attempts: 2,
      maxAttempts: 2,
    }),
    sink: workNode("sink", ["exhausted"]),
  };

  const edges: Edge[] = [{ from: "exhausted", to: "sink", type: "hard" }];

  return makeGraph(nodes, edges, {
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["sink"],
    },
  });
}

describe("replan and rollback", () => {
  it("accepts valid checkpoint replan and updates version/budget/history", () => {
    const graph = makeCheckpointGraph();

    const next = applyReplan(graph, {
      trigger: ReplanTrigger.GATE_FAILURE,
      triggeredAtNodeId: "quality-gate",
      reason: "split failing test remediation into dedicated node",
      triggeredBy: "agent",
      now: "2026-02-14T12:00:00.000Z",
      addNodes: {
        "fix-edge-case": workNode("fix-edge-case", ["tests"], { estimateMinutes: 25 }),
      },
      rewireDeps: {
        "quality-gate": ["fix-edge-case"],
      },
      estimateUpdates: {
        tests: 15,
      },
    });

    expect(next.graphVersion).toBe(3);
    expect(next.policy.replanBudgetRemaining).toBe(1);
    expect(next.nodes["fix-edge-case"]).toBeDefined();
    expect(next.nodes["quality-gate"].deps).toEqual(["fix-edge-case"]);
    expect(next.versionHistory[next.versionHistory.length - 1]).toEqual(
      expect.objectContaining({
        eventType: "replan",
        fromVersion: 2,
        toVersion: 3,
        triggeredAtNodeId: "quality-gate",
      }),
    );
  });

  it("rejects replan when budget is exhausted", () => {
    const graph = makeCheckpointGraph();
    graph.policy.replanBudgetRemaining = 0;

    expect(() =>
      applyReplan(graph, {
        trigger: ReplanTrigger.GATE_FAILURE,
        triggeredAtNodeId: "quality-gate",
        reason: "budget should reject",
        triggeredBy: "agent",
      }),
    ).toThrow(ReplanBudgetExceededError);
  });

  it("rejects removal of required gates", () => {
    const graph = makeCheckpointGraph();

    expect(() =>
      applyReplan(graph, {
        trigger: ReplanTrigger.GATE_FAILURE,
        triggeredAtNodeId: "quality-gate",
        reason: "attempt to remove required gate",
        triggeredBy: "agent",
        removeNodes: ["quality-gate"],
      }),
    ).toThrow(ReplanConstraintViolationError);
  });

  it("rollback resets nodes after checkpoint and records rollback event", () => {
    const graph = makeCheckpointGraph();
    const testsNode = graph.nodes.tests;
    if (testsNode.type === "work") {
      testsNode.status = "failed";
      testsNode.attempts = 2;
      testsNode.output = { logs: "failure output" };
    }
    graph.nodes["quality-gate"].status = "failed";

    const next = rollbackToCheckpoint(graph, {
      checkpointNodeId: "progress-gate",
      reason: "manual rollback for clean retry",
      triggeredBy: "human",
      now: "2026-02-14T12:30:00.000Z",
    });

    expect(next.nodes.tests.status).toBe("pending");
    expect(next.nodes["quality-gate"].status).toBe("pending");
    const resetTests = next.nodes.tests;
    if (resetTests.type !== "work") {
      throw new Error("Expected tests node to be work node");
    }
    expect(resetTests.attempts).toBe(0);
    expect(resetTests.output).toBeUndefined();
    expect(next.versionHistory[next.versionHistory.length - 1]).toEqual(
      expect.objectContaining({
        eventType: "rollback",
        toCheckpoint: "progress-gate",
      }),
    );
  });

  it("allows one-time direct exception at exhausted work node with no reachable checkpoint", () => {
    const graph = makeExhaustedNoCheckpointGraph();

    const first = applyReplan(graph, {
      trigger: ReplanTrigger.WORK_EXHAUSTED,
      triggeredAtNodeId: "exhausted",
      reason: "one-time direct replan for exhausted node",
      triggeredBy: "agent",
      addNodes: {
        "recovery-step": workNode("recovery-step", ["exhausted"]),
      },
      rewireDeps: {
        sink: ["recovery-step"],
      },
    });

    expect(first.nodes["recovery-step"]).toBeDefined();

    expect(() =>
      applyReplan(first, {
        trigger: ReplanTrigger.WORK_EXHAUSTED,
        triggeredAtNodeId: "exhausted",
        reason: "second direct exception should fail",
        triggeredBy: "agent",
      }),
    ).toThrow(InvalidReplanPointError);
  });
});

/**
 * @jest-environment node
 */

import fc from "fast-check";

import { DEFAULT_EXECUTION_POLICY } from "@/src/graph/constants";
import { executeNode } from "@/src/graph/executor";
import { applyReplan, ReplanBudgetExceededError, ReplanTrigger } from "@/src/graph/replan";
import { rollbackToCheckpoint } from "@/src/graph/rollback";
import { schedulerTick } from "@/src/graph/scheduler";
import { verifyGate } from "@/src/graph/gate-verifier";
import type {
  ExecutionGraph,
  GateNode,
  GraphNode,
  WorkNode,
} from "@/src/graph/types";

function workNode(overrides: Partial<WorkNode> = {}): WorkNode {
  return {
    type: "work",
    status: "pending",
    deps: [],
    title: "Work",
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: {
      backoffMs: 1,
      onExhaust: "fail",
    },
    ...overrides,
  };
}

function gateNode(overrides: Partial<GateNode> = {}): GateNode {
  return {
    type: "gate",
    status: "pending",
    deps: [],
    gateType: "quality_gate",
    required: false,
    verificationStrategy: {
      type: "auto",
      checks: ["tests_pass"],
    },
    ...overrides,
  };
}

function makeGraph(
  nodes: Record<string, GraphNode>,
  overrides: Partial<ExecutionGraph> = {},
): ExecutionGraph {
  const edges = Object.entries(nodes).flatMap(([nodeId, node]) =>
    node.deps.map((depId) => ({ from: depId, to: nodeId, type: "hard" as const })),
  );

  return {
    id: "integration-graph",
    taskId: "task-integration",
    graphVersion: 1,
    mode: "PROJECT",
    nodes,
    edges,
    policy: {
      ...DEFAULT_EXECUTION_POLICY,
      replanBudgetRemaining: 2,
      replanBudgetInitial: 2,
      verifyBudgetRemaining: 2,
      verifyBudgetInitial: 2,
      maxConcurrent: 2,
      maxConcurrentAutoChecks: 1,
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: [],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function alwaysPassChecks(): Parameters<typeof verifyGate>[0]["executor"] {
  return async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 1,
    timedOut: false,
  });
}

function alwaysFailChecks(): Parameters<typeof verifyGate>[0]["executor"] {
  return async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "failed",
    durationMs: 1,
    timedOut: false,
  });
}

describe("graph integration matrix", () => {
  test("graph lifecycle: create -> execute -> replan -> verify -> done", async () => {
    const createdGraph = makeGraph(
      {
        bootstrap: workNode({ title: "Bootstrap" }),
        "quality-gate": gateNode({
          deps: ["bootstrap"],
          gateType: "quality_gate",
          required: false,
          verificationStrategy: { type: "auto", checks: ["tests_pass"] },
        }),
        "handoff-gate": gateNode({
          deps: ["quality-gate"],
          gateType: "handoff_gate",
          required: true,
          verificationStrategy: { type: "human" },
        }),
      },
      {
        doneCriteria: {
          allRequiredGatesPassed: true,
          noRunnableOrPendingWork: true,
          completionSinkNodeIds: ["handoff-gate"],
        },
      },
    );

    const executed = await executeNode(createdGraph, "bootstrap", {
      dispatchWork: async () => ({ status: "success" }),
    });
    expect(executed.graph.nodes.bootstrap.status).toBe("done");

    const failedGate = await executeNode(executed.graph, "quality-gate", {
      checkExecutor: alwaysFailChecks(),
    });
    expect(failedGate.graph.nodes["quality-gate"].status).toBe("failed");

    const replanned = applyReplan(failedGate.graph, {
      trigger: ReplanTrigger.GATE_FAILURE,
      triggeredAtNodeId: "quality-gate",
      reason: "insert fix step after failed gate",
      triggeredBy: "agent",
      addNodes: {
        "fix-work": workNode({
          title: "Fix failing checks",
          deps: ["bootstrap"],
        }),
      },
      rewireDeps: {
        "handoff-gate": ["fix-work"],
      },
    });

    expect(replanned.graphVersion).toBe(2);
    expect(replanned.policy.replanBudgetRemaining).toBe(1);

    const fixed = await executeNode(replanned, "fix-work", {
      dispatchWork: async () => ({ status: "success", output: { patch: "applied" } }),
    });
    expect(fixed.graph.nodes["fix-work"].status).toBe("done");

    const awaitingHuman = await executeNode(fixed.graph, "handoff-gate", {
      checkExecutor: alwaysPassChecks(),
    });
    expect(awaitingHuman.graph.nodes["handoff-gate"].status).toBe("awaiting_human");

    const approved = await executeNode(awaitingHuman.graph, "handoff-gate", {
      checkExecutor: alwaysPassChecks(),
      humanDecisionsByGateId: { "handoff-gate": "approve" },
    });
    expect(approved.graph.nodes["handoff-gate"].status).toBe("passed");

    const finalTick = schedulerTick(approved.graph);
    expect(finalTick.complete).toBe(true);
  });

  test("budget decrements and limits for verify + replan", async () => {
    const gate = gateNode({ status: "pending", gateType: "quality_gate", required: true });
    const basePolicy = {
      ...DEFAULT_EXECUTION_POLICY,
      verifyBudgetInitial: 2,
      verifyBudgetRemaining: 2,
    };

    const firstVerify = await verifyGate({
      gateId: "quality-gate",
      gate,
      policy: basePolicy,
      executor: alwaysFailChecks(),
      now: new Date().toISOString(),
    });
    expect(firstVerify.policy.verifyBudgetRemaining).toBe(1);
    expect(firstVerify.escalated).toBe(false);

    const secondVerify = await verifyGate({
      gateId: "quality-gate",
      gate,
      policy: {
        ...basePolicy,
        verifyBudgetRemaining: 1,
      },
      executor: alwaysFailChecks(),
      now: new Date().toISOString(),
    });
    expect(secondVerify.policy.verifyBudgetRemaining).toBe(0);
    expect(secondVerify.escalated).toBe(true);

    const checkpointGraph = makeGraph({
      start: workNode({ status: "done" }),
      "quality-gate": gateNode({
        status: "failed",
        deps: ["start"],
        gateType: "quality_gate",
        required: false,
      }),
      sink: workNode({ deps: ["quality-gate"] }),
    }, {
      policy: {
        ...DEFAULT_EXECUTION_POLICY,
        replanBudgetInitial: 1,
        replanBudgetRemaining: 1,
      },
      doneCriteria: {
        allRequiredGatesPassed: true,
        noRunnableOrPendingWork: true,
        completionSinkNodeIds: ["sink"],
      },
    });

    const firstReplan = applyReplan(checkpointGraph, {
      trigger: ReplanTrigger.GATE_FAILURE,
      triggeredAtNodeId: "quality-gate",
      reason: "add recovery node",
      triggeredBy: "agent",
      addNodes: {
        recovery: workNode({ deps: ["start"], title: "Recovery" }),
      },
      rewireDeps: {
        sink: ["recovery"],
      },
    });
    expect(firstReplan.policy.replanBudgetRemaining).toBe(0);

    expect(() =>
      applyReplan(firstReplan, {
        trigger: ReplanTrigger.GATE_FAILURE,
        triggeredAtNodeId: "quality-gate",
        reason: "second replan should fail budget",
        triggeredBy: "agent",
      }),
    ).toThrow(ReplanBudgetExceededError);
  });

  test("maxConcurrent is work-only; maxConcurrentAutoChecks gates auto/hybrid", () => {
    const graph = makeGraph(
      {
        "work-running": workNode({ status: "running" }),
        "work-a": workNode(),
        "work-b": workNode(),
        "gate-human": gateNode({
          gateType: "approval_gate",
          verificationStrategy: { type: "human" },
        }),
        "gate-auto-running": gateNode({ status: "running", verificationStrategy: { type: "auto", checks: ["tests_pass"] } }),
        "gate-auto-a": gateNode({ verificationStrategy: { type: "auto", checks: ["tests_pass"] } }),
        "gate-hybrid-b": gateNode({ verificationStrategy: { type: "hybrid", checks: ["tests_pass"] } }),
      },
      {
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          maxConcurrent: 2,
          maxConcurrentAutoChecks: 2,
        },
      },
    );

    const tick = schedulerTick(graph);
    expect(tick.workToRun).toHaveLength(1);
    expect(tick.autoGatesToRun).toHaveLength(1);
    expect(tick.lightweightGatesToRun).toEqual(["gate-human"]);
    expect(tick.dispatchOrder).toEqual(["gate-human", "gate-auto-a", "work-a"]);
  });

  test("fast-check: scheduler concurrency invariants hold across randomized runnable sets", () => {
    const arb = fc.record({
      maxConcurrent: fc.integer({ min: 1, max: 4 }),
      maxConcurrentAutoChecks: fc.integer({ min: 1, max: 3 }),
      runningWork: fc.integer({ min: 0, max: 3 }),
      pendingWork: fc.integer({ min: 0, max: 5 }),
      runningAuto: fc.integer({ min: 0, max: 3 }),
      pendingAuto: fc.integer({ min: 0, max: 5 }),
      pendingHuman: fc.integer({ min: 0, max: 3 }),
    });

    fc.assert(
      fc.property(arb, (sample) => {
        const nodes: Record<string, GraphNode> = {};

        for (let index = 0; index < sample.runningWork; index += 1) {
          nodes[`rw-${index}`] = workNode({ status: "running" });
        }
        for (let index = 0; index < sample.pendingWork; index += 1) {
          nodes[`pw-${index}`] = workNode({ status: "pending" });
        }
        for (let index = 0; index < sample.runningAuto; index += 1) {
          nodes[`ra-${index}`] = gateNode({
            status: "running",
            verificationStrategy: { type: "auto", checks: ["tests_pass"] },
          });
        }
        for (let index = 0; index < sample.pendingAuto; index += 1) {
          nodes[`pa-${index}`] = gateNode({
            status: "pending",
            verificationStrategy: { type: index % 2 === 0 ? "auto" : "hybrid", checks: ["tests_pass"] },
          });
        }
        for (let index = 0; index < sample.pendingHuman; index += 1) {
          nodes[`ph-${index}`] = gateNode({
            status: "pending",
            gateType: "approval_gate",
            verificationStrategy: { type: "human" },
          });
        }

        const graph = makeGraph(nodes, {
          policy: {
            ...DEFAULT_EXECUTION_POLICY,
            maxConcurrent: sample.maxConcurrent,
            maxConcurrentAutoChecks: sample.maxConcurrentAutoChecks,
          },
        });

        const tick = schedulerTick(graph);
        const availableWork = Math.max(0, sample.maxConcurrent - sample.runningWork);
        const availableAuto = Math.max(0, sample.maxConcurrentAutoChecks - sample.runningAuto);

        expect(tick.workToRun.length).toBeLessThanOrEqual(availableWork);
        expect(tick.autoGatesToRun.length).toBeLessThanOrEqual(availableAuto);
        expect(tick.lightweightGatesToRun.length).toBe(sample.pendingHuman);
      }),
      { numRuns: 100 },
    );
  });

  test("rollback is logical-only: downstream runtime state resets without implying side-effect reversal", () => {
    const graph = makeGraph(
      {
        prep: workNode({
          status: "done",
          output: { externalTicket: "ABC-123" },
          attempts: 1,
        }),
        checkpoint: gateNode({
          status: "passed",
          deps: ["prep"],
          gateType: "progress",
          verificationStrategy: { type: "auto" },
        }),
        deploy: workNode({
          status: "failed",
          deps: ["checkpoint"],
          attempts: 2,
          maxAttempts: 2,
          output: { deploymentId: "dep-1", externalMutation: true },
        }),
        verify: gateNode({
          status: "failed",
          deps: ["deploy"],
          gateType: "quality_gate",
          required: true,
          verificationStrategy: { type: "auto", checks: ["tests_pass"] },
        }),
      },
      {
        doneCriteria: {
          allRequiredGatesPassed: true,
          noRunnableOrPendingWork: true,
          completionSinkNodeIds: ["verify"],
        },
      },
    );

    const rolledBack = rollbackToCheckpoint(graph, {
      checkpointNodeId: "checkpoint",
      reason: "retry deployment path",
      triggeredBy: "human",
      now: new Date().toISOString(),
    });

    expect(rolledBack.nodes.prep.type).toBe("work");
    if (rolledBack.nodes.prep.type === "work") {
      expect(rolledBack.nodes.prep.output).toEqual({ externalTicket: "ABC-123" });
    }

    expect(rolledBack.nodes.deploy.status).toBe("pending");
    if (rolledBack.nodes.deploy.type === "work") {
      expect(rolledBack.nodes.deploy.attempts).toBe(0);
      expect(rolledBack.nodes.deploy.output).toBeUndefined();
    }
    expect(rolledBack.nodes.verify.status).toBe("pending");

    const latestHistory = rolledBack.versionHistory[rolledBack.versionHistory.length - 1];
    expect(latestHistory.eventType).toBe("rollback");
  });
});

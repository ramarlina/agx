/**
 * @jest-environment node
 */

import conditionalElseJoinAnyFixture from "@/__tests__/graph/fixtures/conditional-else-join-any.json";
import conditionalThenJoinAllFixture from "@/__tests__/graph/fixtures/conditional-then-join-all.json";
import awaitingHumanGateBlockerFixture from "@/__tests__/graph/fixtures/awaiting-human-gate-blocker.json";
import joinNOfMSoftFailureFixture from "@/__tests__/graph/fixtures/join-n-of-m-soft-failure.json";
import requiredGateBypassInvalidFixture from "@/__tests__/graph/fixtures/required-gate-bypass-invalid.json";
import retryExhaustOnExhaustSkipFixture from "@/__tests__/graph/fixtures/retry-exhaust-onexhaust-skip.json";
import softBlockedDoesNotStallFixture from "@/__tests__/graph/fixtures/soft-blocked-does-not-stall.json";

import { executeNode } from "@/src/graph/executor";
import { findRunnableWorkAndGateNodes, schedulerTick } from "@/src/graph/scheduler";
import type { ExecutionGraph, GraphNode } from "@/src/graph/types";
import { validateGraph } from "@/src/graph/validate";

function cloneGraph(graph: ExecutionGraph): ExecutionGraph {
  return structuredClone(graph);
}

function tickControl(graph: ExecutionGraph, times = 2): ExecutionGraph {
  let next = cloneGraph(graph);
  for (let index = 0; index < times; index += 1) {
    next = schedulerTick(next).graph;
  }
  return next;
}

function findCurrentBlocker(graph: ExecutionGraph): string | null {
  const validation = validateGraph(graph);
  const topo = validation.topologicalOrder.length > 0
    ? validation.topologicalOrder
    : Object.keys(graph.nodes);

  const requiredGateEntries = topo
    .map((nodeId) => [nodeId, graph.nodes[nodeId]] as const)
    .filter((entry): entry is [string, Extract<GraphNode, { type: "gate" }>] => {
      const [, node] = entry;
      return node?.type === "gate" && node.required;
    });

  const failedGate = requiredGateEntries.find(([, node]) => node.status === "failed");
  if (failedGate) {
    return failedGate[0];
  }

  const awaitingHumanGate = requiredGateEntries.find(([, node]) => node.status === "awaiting_human");
  if (awaitingHumanGate) {
    return awaitingHumanGate[0];
  }

  const pendingOrRunningRequiredGate = requiredGateEntries.find(
    ([, node]) => node.status === "pending" || node.status === "running",
  );
  if (pendingOrRunningRequiredGate) {
    return pendingOrRunningRequiredGate[0];
  }

  const blockedWorkNodeId = topo.find((nodeId) => {
    const node = graph.nodes[nodeId];
    return node?.type === "work" && node.status === "blocked";
  });

  return blockedWorkNodeId ?? null;
}

describe("graph reference fixtures (§13.9)", () => {
  test("conditional-then-join-all.json: then branch selected, else skipped, join(all) succeeds", () => {
    const graph = tickControl(conditionalThenJoinAllFixture.graph as ExecutionGraph, 2);

    expect(graph.nodes.cond.type).toBe("conditional");
    if (graph.nodes.cond.type === "conditional") {
      expect(graph.nodes.cond.evaluatedTo).toBe("then");
    }
    expect(graph.nodes["else-work"].status).toBe("skipped");
    expect(graph.nodes.join.status).toBe("done");
  });

  test("conditional-else-join-any.json: else branch selected, join(any) succeeds", () => {
    const graph = tickControl(conditionalElseJoinAnyFixture.graph as ExecutionGraph, 2);

    expect(graph.nodes.cond.type).toBe("conditional");
    if (graph.nodes.cond.type === "conditional") {
      expect(graph.nodes.cond.evaluatedTo).toBe("else");
    }
    expect(graph.nodes["then-work"].status).toBe("skipped");
    expect(graph.nodes.join.status).toBe("done");
  });

  test("join-n-of-m-soft-failure.json: join(n_of_m) succeeds at threshold with soft failed dep", () => {
    const graph = tickControl(joinNOfMSoftFailureFixture.graph as ExecutionGraph, 2);

    expect(graph.nodes.join.type).toBe("join");
    expect(graph.nodes.join.status).toBe("done");
  });

  test("required-gate-bypass-invalid.json: validateGraph rejects required gate bypass", () => {
    const validation = validateGraph(requiredGateBypassInvalidFixture.graph as ExecutionGraph);

    expect(validation.valid).toBe(false);
    expect(validation.errors.requiredGateNonBypass.join(" ")).toContain("Required gate");
    expect(validation.errors.requiredGateNonBypass.join(" ")).toContain("bypassed");
  });

  test("soft-blocked-does-not-stall.json: blocked soft dep does not stall downstream", () => {
    const graph = cloneGraph(softBlockedDoesNotStallFixture.graph as ExecutionGraph);
    const runnable = findRunnableWorkAndGateNodes(graph);

    expect(runnable.workRunnable).toContain("downstream");
  });

  test("awaiting-human-gate-blocker.json: required awaiting_human gate is current blocker", () => {
    const graph = cloneGraph(awaitingHumanGateBlockerFixture.graph as ExecutionGraph);

    expect(findCurrentBlocker(graph)).toBe("handoff-gate");
  });

  test("retry-exhaust-onexhaust-skip.json: retries exhaust then node transitions to skipped", async () => {
    const graph = cloneGraph(retryExhaustOnExhaustSkipFixture.graph as ExecutionGraph);
    const now = new Date().toISOString();
    graph.createdAt = now;
    graph.updatedAt = now;
    const failTransiently = async () => ({ status: "failure" as const, transient: true, message: "retry" });

    const first = await executeNode(graph, "retry-work", {
      dispatchWork: failTransiently,
      sleep: async () => undefined,
    });
    expect(first.graph.nodes["retry-work"].status).toBe("pending");

    const second = await executeNode(first.graph, "retry-work", {
      dispatchWork: failTransiently,
      sleep: async () => undefined,
    });
    expect(second.graph.nodes["retry-work"].status).toBe("skipped");
  });
});

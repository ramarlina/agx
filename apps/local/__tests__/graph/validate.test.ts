/**
 * @jest-environment node
 */

import fc from "fast-check";

import { DEFAULT_EXECUTION_POLICY } from "@/src/graph/constants";
import type {
  ConditionalNode,
  Edge,
  ExecutionGraph,
  GateNode,
  GraphNode,
  JoinNode,
  WorkNode,
} from "@/src/graph/types";
import { validateGraph } from "@/src/graph/validate";

function workNode(id: string, deps: string[] = [], overrides: Partial<WorkNode> = {}): WorkNode {
  return {
    type: "work",
    status: "pending",
    deps,
    title: id,
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: { backoffMs: 1_000, onExhaust: "fail" },
    ...overrides,
  };
}

function gateNode(
  deps: string[] = [],
  required = false,
  overrides: Partial<GateNode> = {},
): GateNode {
  return {
    type: "gate",
    status: "pending",
    deps,
    gateType: "quality_gate",
    required,
    verificationStrategy: { type: "auto" },
    ...overrides,
  };
}

function conditionalNode(
  deps: string[] = [],
  thenBranch: string[] = [],
  elseBranch: string[] = [],
  overrides: Partial<ConditionalNode> = {},
): ConditionalNode {
  return {
    type: "conditional",
    status: "pending",
    deps,
    condition: {
      expression: "ctx.input.shouldRunThen == true",
      inputFrom: deps[0] ?? "start",
    },
    thenBranch,
    elseBranch,
    ...overrides,
  };
}

function joinNode(
  deps: string[] = [],
  overrides: Partial<JoinNode> = {},
): JoinNode {
  return {
    type: "join",
    status: "pending",
    deps,
    joinStrategy: "all",
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
    graphVersion: 1,
    mode: "PROJECT",
    nodes,
    edges,
    policy: { ...DEFAULT_EXECUTION_POLICY },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: "2026-02-14T00:00:00Z",
    updatedAt: "2026-02-14T00:00:00Z",
    ...overrides,
  };
}

function makeRequiredGateChainGraph(): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    start: workNode("start", []),
    "required-gate": gateNode(["start"], true),
    sink: workNode("sink", ["required-gate"]),
  };

  const edges: Edge[] = [
    { from: "start", to: "required-gate", type: "hard" },
    { from: "required-gate", to: "sink", type: "hard" },
  ];

  return makeGraph(nodes, edges);
}

function makeSimpleAcyclicGraph(): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    a: workNode("a", []),
    b: workNode("b", ["a"]),
    c: workNode("c", ["b"]),
  };
  const edges: Edge[] = [
    { from: "a", to: "b", type: "hard" },
    { from: "b", to: "c", type: "hard" },
  ];

  return makeGraph(nodes, edges);
}

function makeConditionalGraph(): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    start: workNode("start", []),
    cond: conditionalNode(["start"], ["then-root", "then-next"], ["else-root"]),
    "then-root": workNode("then-root", ["cond"]),
    "then-next": workNode("then-next", ["then-root"]),
    "else-root": workNode("else-root", ["cond"]),
    join: workNode("join", ["then-next", "else-root"]),
  };

  const edges: Edge[] = [
    { from: "start", to: "cond", type: "hard" },
    { from: "cond", to: "then-root", type: "hard" },
    { from: "then-root", to: "then-next", type: "hard" },
    { from: "cond", to: "else-root", type: "hard" },
    { from: "then-next", to: "join", type: "hard" },
    { from: "else-root", to: "join", type: "hard" },
  ];

  return makeGraph(nodes, edges);
}

function makeJoinNOfMGraph(requiredCount: number): ExecutionGraph {
  const nodes: Record<string, GraphNode> = {
    a: workNode("a", []),
    b: workNode("b", []),
    c: workNode("c", []),
    join: joinNode(["a", "b", "c"], { joinStrategy: "n_of_m", requiredCount }),
    sink: workNode("sink", ["join"]),
  };
  const edges: Edge[] = [
    { from: "a", to: "join", type: "hard" },
    { from: "b", to: "join", type: "hard" },
    { from: "c", to: "join", type: "hard" },
    { from: "join", to: "sink", type: "hard" },
  ];

  return makeGraph(nodes, edges);
}

describe("validateGraph", () => {
  describe("DAG invariant", () => {
    it("accepts an acyclic graph", () => {
      const graph = makeSimpleAcyclicGraph();

      const result = validateGraph(graph);

      expect(result.errors.dag).toHaveLength(0);
      expect(result.topologicalOrder).toEqual(["a", "b", "c"]);
    });

    it("rejects a graph with a cycle", () => {
      const graph = makeSimpleAcyclicGraph();
      graph.nodes.a.deps.push("c");
      graph.edges.push({ from: "c", to: "a", type: "hard" });

      const result = validateGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.dag.length).toBeGreaterThan(0);
    });
  });

  describe("deps/edges consistency invariant", () => {
    it("accepts matching deps and edges", () => {
      const graph = makeSimpleAcyclicGraph();

      const result = validateGraph(graph);

      expect(result.errors.depsEdgesConsistency).toHaveLength(0);
    });

    it("rejects a dep that has no matching edge", () => {
      const graph = makeSimpleAcyclicGraph();
      graph.nodes.c.deps = ["b", "a"];

      const result = validateGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.depsEdgesConsistency).toEqual(
        expect.arrayContaining([
          expect.stringContaining('dependency "a" has no matching edge'),
        ]),
      );
    });
  });

  describe("required-gate non-bypass invariant", () => {
    it("accepts graph where all hard paths transit required gate", () => {
      const graph = makeRequiredGateChainGraph();

      const result = validateGraph(graph);

      expect(result.errors.requiredGateNonBypass).toHaveLength(0);
    });

    it("rejects graph with hard-path bypass around required gate", () => {
      const graph = makeRequiredGateChainGraph();
      graph.nodes.sink.deps.push("start");
      graph.edges.push({ from: "start", to: "sink", type: "hard" });

      const result = validateGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.requiredGateNonBypass).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Required gate "required-gate" is bypassed'),
        ]),
      );
    });
  });

  describe("conditional branch exclusivity invariant", () => {
    it("accepts disjoint branches rooted at the conditional node", () => {
      const graph = makeConditionalGraph();

      const result = validateGraph(graph);

      expect(result.errors.conditionalBranchExclusivity).toHaveLength(0);
    });

    it("rejects external hard incoming edges into a branch node", () => {
      const graph = makeConditionalGraph();
      graph.nodes["then-next"].deps.push("start");
      graph.edges.push({ from: "start", to: "then-next", type: "hard" });

      const result = validateGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.conditionalBranchExclusivity).toEqual(
        expect.arrayContaining([
          expect.stringContaining('node "then-next" has external hard incoming edge from "start"'),
        ]),
      );
    });
  });

  describe("join strategy invariant", () => {
    it("accepts n_of_m joins with requiredCount <= deps.length", () => {
      const graph = makeJoinNOfMGraph(2);

      const result = validateGraph(graph);

      expect(result.errors.joinStrategy).toHaveLength(0);
    });

    it("rejects n_of_m joins when requiredCount exceeds deps.length", () => {
      const graph = makeJoinNOfMGraph(4);

      const result = validateGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.joinStrategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("requiredCount (4) exceeds deps length (3)"),
        ]),
      );
    });
  });

  describe("Appendix A compatibility", () => {
    it("does not produce false positives on the Appendix A example graph", () => {
      const appendixGraph = makeGraph(
        {
          design: workNode("Design authentication system", [], {
            status: "done",
            estimateMinutes: 45,
            actualMinutes: 38,
            attempts: 1,
            retryPolicy: { backoffMs: 5_000, onExhaust: "escalate" },
            output: { designDoc: "auth-design.md" },
          }),
          "design-gate": gateNode(["design"], false, {
            gateType: "design_gate",
            status: "passed",
          }),
          "fork-impl": {
            type: "fork",
            status: "done",
            deps: ["design-gate"],
          },
          "implement-auth": workNode("Implement auth module", ["fork-impl"], {
            status: "done",
            estimateMinutes: 60,
            actualMinutes: 55,
            attempts: 1,
            retryPolicy: { backoffMs: 5_000, onExhaust: "escalate" },
          }),
          "write-tests": workNode("Write test suite", ["fork-impl"], {
            status: "done",
            estimateMinutes: 30,
            actualMinutes: 35,
            attempts: 2,
            retryPolicy: { backoffMs: 5_000, onExhaust: "escalate" },
          }),
          "update-docs": workNode("Update documentation", ["fork-impl"], {
            status: "running",
            estimateMinutes: 20,
            attempts: 1,
            retryPolicy: { backoffMs: 5_000, onExhaust: "skip" },
          }),
          "join-impl": joinNode(["implement-auth", "write-tests", "update-docs"], {
            status: "pending",
            joinStrategy: "all",
          }),
          "quality-gate": gateNode(["join-impl"], true, {
            gateType: "quality_gate",
            status: "pending",
            verificationStrategy: {
              type: "auto",
              checks: ["tests_pass", "lint_clean", "coverage_threshold"],
            },
          }),
          "handoff-gate": gateNode(["quality-gate"], true, {
            gateType: "handoff_gate",
            status: "pending",
            verificationStrategy: { type: "human" },
          }),
        },
        [
          { from: "design", to: "design-gate", type: "hard" },
          { from: "design-gate", to: "fork-impl", type: "hard" },
          { from: "fork-impl", to: "implement-auth", type: "hard" },
          { from: "fork-impl", to: "write-tests", type: "hard" },
          { from: "fork-impl", to: "update-docs", type: "soft" },
          { from: "implement-auth", to: "join-impl", type: "hard" },
          { from: "write-tests", to: "join-impl", type: "hard" },
          { from: "update-docs", to: "join-impl", type: "soft" },
          { from: "join-impl", to: "quality-gate", type: "hard" },
          { from: "quality-gate", to: "handoff-gate", type: "hard" },
        ],
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          taskId: "task-123",
          graphVersion: 3,
          policy: {
            replanBudgetRemaining: 1,
            replanBudgetInitial: 3,
            verifyBudgetRemaining: 4,
            verifyBudgetInitial: 5,
            maxConcurrentAutoChecks: 1,
            immutableRequiredGates: true,
            maxConcurrent: 3,
            priorityMode: "critical_path",
            nodeTimeoutMs: 1_800_000,
            graphTimeoutMs: 86_400_000,
          },
          versionHistory: [
            {
              eventType: "replan",
              fromVersion: 1,
              toVersion: 2,
              timestamp: "2026-02-13T10:30:00Z",
              reason: "Added parallel implementation streams",
              triggeredBy: "agent",
              triggeredAtNodeId: "design-gate",
              changes: {
                addedNodes: ["fork-impl", "join-impl", "update-docs"],
                removedNodes: [],
                rewiredDeps: ["implement-auth", "write-tests"],
                estimateDeltas: {},
              },
            },
            {
              eventType: "replan",
              fromVersion: 2,
              toVersion: 3,
              timestamp: "2026-02-13T11:45:00Z",
              reason:
                "Quality gate failed: coverage below threshold after first test run, adjusted estimates for test rework",
              triggeredBy: "agent",
              triggeredAtNodeId: "quality-gate",
              changes: {
                addedNodes: [],
                removedNodes: [],
                rewiredDeps: [],
                estimateDeltas: { "write-tests": 5 },
              },
            },
          ],
          createdAt: "2026-02-13T09:00:00Z",
          updatedAt: "2026-02-13T11:45:00Z",
        },
      );

      const result = validateGraph(appendixGraph);

      expect(result.valid).toBe(true);
      expect(result.errors.dag).toHaveLength(0);
      expect(result.errors.depsEdgesConsistency).toHaveLength(0);
      expect(result.errors.requiredGateNonBypass).toHaveLength(0);
      expect(result.errors.conditionalBranchExclusivity).toHaveLength(0);
      expect(result.errors.joinStrategy).toHaveLength(0);
    });
  });
});

describe("validateGraph property-based fuzzing", () => {
  function dagGraphArbitrary(): fc.Arbitrary<ExecutionGraph> {
    return fc.integer({ min: 1, max: 8 }).chain((nodeCount) => {
      const nodeIds = Array.from({ length: nodeCount }, (_, index) => `n-${index}`);
      const possibleEdges: Array<[string, string]> = [];

      for (let i = 0; i < nodeIds.length; i += 1) {
        for (let j = i + 1; j < nodeIds.length; j += 1) {
          possibleEdges.push([nodeIds[i], nodeIds[j]]);
        }
      }

      return fc.subarray(possibleEdges).map((selectedEdges) => {
        const depsByNode = new Map<string, string[]>(
          nodeIds.map((nodeId) => [nodeId, []]),
        );

        const edges: Edge[] = selectedEdges.map(([from, to]) => {
          depsByNode.get(to)?.push(from);
          return { from, to, type: "hard" };
        });

        const nodes: Record<string, GraphNode> = {};
        for (const nodeId of nodeIds) {
          nodes[nodeId] = workNode(nodeId, depsByNode.get(nodeId) ?? []);
        }

        return makeGraph(nodes, edges);
      });
    });
  }

  it("accepts fuzzed DAGs with consistent deps/edges", () => {
    fc.assert(
      fc.property(dagGraphArbitrary(), (graph) => {
        const result = validateGraph(graph);
        expect(result.valid).toBe(true);
        expect(result.errors.dag).toHaveLength(0);
        expect(result.errors.depsEdgesConsistency).toHaveLength(0);
      }),
      { numRuns: 120 },
    );
  });

  it("detects cycles when a back edge is injected into fuzzed DAGs", () => {
    fc.assert(
      fc.property(
        dagGraphArbitrary().filter((graph) => Object.keys(graph.nodes).length > 1),
        (graph) => {
          const nodeIds = Object.keys(graph.nodes);
          const first = nodeIds[0];
          const last = nodeIds[nodeIds.length - 1];

          if (!graph.nodes[last].deps.includes(first)) {
            graph.nodes[last].deps.push(first);
          }
          graph.edges.push({ from: first, to: last, type: "hard" });

          if (!graph.nodes[first].deps.includes(last)) {
            graph.nodes[first].deps.push(last);
          }
          graph.edges.push({ from: last, to: first, type: "hard" });

          const result = validateGraph(graph);
          expect(result.errors.dag.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 120 },
    );
  });
});

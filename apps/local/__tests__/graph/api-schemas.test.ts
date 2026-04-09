import { GraphEnvelopeResponseSchema } from "@/src/graph/api-schemas";

describe("GraphEnvelopeResponseSchema", () => {
  test("accepts paused/stopped statuses for gate, join, and conditional nodes", () => {
    const payload = {
      graph: {
        id: "graph-1",
        taskId: "f1331474-d445-4607-8ac8-0353c51de56b",
        graphVersion: 3,
        mode: "PROJECT" as const,
        nodes: {
          root: {
            type: "root" as const,
            status: "running" as const,
            deps: [],
            title: "Root",
            objective: "Execute task",
            graphCreated: true,
            criteria: [],
          },
          "plan-approval": {
            type: "gate" as const,
            status: "stopped" as const,
            deps: ["root"],
            gateType: "approval_gate" as const,
            required: true,
            verificationStrategy: {
              type: "human" as const,
              checks: [],
            },
          },
          "merge-results": {
            type: "join" as const,
            status: "paused" as const,
            deps: ["plan-approval"],
            joinStrategy: "all" as const,
          },
          "choose-path": {
            type: "conditional" as const,
            status: "stopped" as const,
            deps: ["merge-results"],
            condition: {
              expression: "true",
              inputFrom: "merge-results",
            },
            thenBranch: [],
            elseBranch: [],
          },
        },
        edges: [
          { from: "root", to: "plan-approval", type: "hard" as const, condition: "always" as const },
          { from: "plan-approval", to: "merge-results", type: "hard" as const, condition: "always" as const },
          { from: "merge-results", to: "choose-path", type: "hard" as const, condition: "always" as const },
        ],
        policy: {
          replanBudgetRemaining: 2,
          replanBudgetInitial: 3,
          verifyBudgetRemaining: 4,
          verifyBudgetInitial: 5,
          maxConcurrentAutoChecks: 1,
          immutableRequiredGates: true,
          maxConcurrent: 2,
          priorityMode: "fifo" as const,
          nodeTimeoutMs: 30_000,
          graphTimeoutMs: 120_000,
        },
        doneCriteria: {
          allRequiredGatesPassed: true,
          noRunnableOrPendingWork: true,
          completionSinkNodeIds: ["choose-path"],
        },
        versionHistory: [],
        runtimeEvents: [],
        createdAt: "2026-02-17T00:00:00.000Z",
        updatedAt: "2026-02-17T00:00:00.000Z",
      },
    };

    expect(() => GraphEnvelopeResponseSchema.parse(payload)).not.toThrow();
  });
});

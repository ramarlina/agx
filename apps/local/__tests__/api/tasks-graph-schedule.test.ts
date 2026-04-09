/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

import type { ExecutionGraph, GraphSchedule } from "@/src/graph/types";

const mockAuthorizeGraphMutation = jest.fn();
const mockGetGraph = jest.fn();
const mockUpdateGraphStructure = jest.fn();
const mockGetActiveScheduleForRootMessageId = jest.fn();
const TASK_ID = "11111111-1111-1111-1111-111111111111";

jest.mock("@/src/graph/middleware/authz", () => ({
  authorizeGraphMutation: (...args: unknown[]) => mockAuthorizeGraphMutation(...args),
}));

jest.mock("@/src/graph/store", () => ({
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
  updateGraphStructure: (...args: unknown[]) => mockUpdateGraphStructure(...args),
  getActiveScheduleForRootMessageId: (...args: unknown[]) => mockGetActiveScheduleForRootMessageId(...args),
}));

function makeGraph(schedule?: GraphSchedule): ExecutionGraph {
  return {
    id: "graph-1",
    taskId: TASK_ID,
    graphVersion: 1,
    mode: "SIMPLE",
    nodes: {
      root: {
        type: "root",
        status: "done",
        deps: [],
        title: "Root",
        objective: "Monitor this thread",
        graphCreated: true,
      },
      "pull-status": {
        type: "function",
        status: "pending",
        deps: ["root"],
        kind: "bash",
        title: "Pull Status",
        command: "printf '{\"activeProcessCount\":0}'",
        timeoutMs: 1000,
      },
      "idle-check": {
        type: "conditional",
        status: "pending",
        deps: ["pull-status"],
        condition: {
          expression: "input.activeProcessCount == 0",
          inputFrom: "pull-status",
        },
        thenBranch: ["verify-and-route"],
        elseBranch: [],
      },
      "verify-and-route": {
        type: "work",
        status: "pending",
        deps: ["idle-check"],
        title: "Verify and route",
        workType: "spike",
        attempts: 0,
        maxAttempts: 1,
        retryPolicy: { backoffMs: 0, onExhaust: "fail" },
      },
    },
    edges: [
      { from: "root", to: "pull-status", type: "hard" },
      { from: "pull-status", to: "idle-check", type: "hard" },
      { from: "idle-check", to: "verify-and-route", type: "hard", condition: "on_success" },
    ],
    policy: {
      replanBudgetRemaining: 1,
      replanBudgetInitial: 1,
      verifyBudgetRemaining: 1,
      verifyBudgetInitial: 1,
      maxConcurrentAutoChecks: 1,
      immutableRequiredGates: false,
      maxConcurrent: 1,
      priorityMode: "fifo",
      nodeTimeoutMs: 1000,
      graphTimeoutMs: 60000,
    },
    doneCriteria: {
      allRequiredGatesPassed: false,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["verify-and-route"],
    },
    schedule,
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("/api/tasks/[id]/graph/schedule", () => {
  let storedGraph: ExecutionGraph;

  beforeEach(() => {
    jest.clearAllMocks();
    storedGraph = makeGraph();

    mockAuthorizeGraphMutation.mockResolvedValue({ ok: true });
    mockGetActiveScheduleForRootMessageId.mockReturnValue(null);
    mockGetGraph.mockImplementation((taskId: string) => (taskId === storedGraph.taskId ? storedGraph : null));
    mockUpdateGraphStructure.mockImplementation((_graphId: string, update: Partial<ExecutionGraph>) => {
      storedGraph = {
        ...storedGraph,
        mode: update.mode ?? storedGraph.mode,
        nodes: update.nodes ?? storedGraph.nodes,
        edges: update.edges ?? storedGraph.edges,
        policy: update.policy ?? storedGraph.policy,
        doneCriteria: update.doneCriteria ?? storedGraph.doneCriteria,
        schedule: update.schedule ?? storedGraph.schedule,
        updatedAt: new Date().toISOString(),
      };
      return {
        graphVersion: storedGraph.graphVersion,
        updatedAt: storedGraph.updatedAt,
      };
    });
  });

  test("POST activates a schedule and persists it on the graph", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/graph/schedule/route");
    const response = await POST(
      new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalMs: 60_000,
          resetNodeIds: ["pull-status", "idle-check"],
          name: "Inbox monitor",
        }),
      }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.graph.schedule).toEqual(
      expect.objectContaining({
        state: "active",
        intervalMs: 60_000,
        resetNodeIds: ["pull-status", "idle-check"],
        runCount: 0,
        tickInProgress: false,
      }),
    );
    expect(storedGraph.schedule).toBeDefined();
    expect(mockUpdateGraphStructure).toHaveBeenCalledTimes(1);
  });

  test("POST is idempotent when the graph already has an active schedule", async () => {
    storedGraph = makeGraph({
      intervalMs: 60_000,
      state: "active",
      resetNodeIds: ["pull-status", "idle-check"],
      maxRuns: 10,
      runCount: 3,
      tickInProgress: false,
      createdAt: "2026-03-01T00:00:00.000Z",
      lastTickAt: 123456,
    });

    const { POST } = await import("@/app/api/tasks/[id]/graph/schedule/route");
    const response = await POST(
      new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalMs: 60_000,
          resetNodeIds: ["pull-status", "idle-check"],
          maxRuns: 10,
        }),
      }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.graph.schedule.createdAt).toBe("2026-03-01T00:00:00.000Z");
    expect(payload.graph.schedule.runCount).toBe(3);
    expect(payload.graph.schedule.lastTickAt).toBe(123456);
    expect(mockUpdateGraphStructure).not.toHaveBeenCalled();
  });

  test("DELETE stops an active schedule and clears the tick lock", async () => {
    storedGraph = makeGraph({
      intervalMs: 60_000,
      state: "active",
      resetNodeIds: ["pull-status", "idle-check"],
      runCount: 2,
      tickInProgress: true,
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    const { DELETE } = await import("@/app/api/tasks/[id]/graph/schedule/route");
    const response = await DELETE(
      new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/schedule`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.graph.schedule).toEqual(
      expect.objectContaining({
        state: "stopped",
        tickInProgress: false,
      }),
    );
    expect(mockUpdateGraphStructure).toHaveBeenCalledTimes(1);
  });
});

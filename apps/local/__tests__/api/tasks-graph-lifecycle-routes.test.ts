/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

const mockCreateAdminDbClient = jest.fn();
const mockGetGraph = jest.fn();
const mockSyncTaskProgressForGraphExecution = jest.fn();

jest.mock("@/lib/auth-mode", () => ({
  LOCAL_USER: { id: "local-user-1" },
}));

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: (...args: unknown[]) => mockCreateAdminDbClient(...args),
}));

jest.mock("@/src/graph/store", () => ({
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
}));

jest.mock("@/src/graph/task-lifecycle", () => ({
  syncTaskProgressForGraphExecution: (...args: unknown[]) =>
    mockSyncTaskProgressForGraphExecution(...args),
}));

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
};

function buildGraph(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "graph-1",
    taskId: TASK_ID,
    executionState: "running",
    graphVersion: 1,
    mode: "SIMPLE",
    nodes: {
      "work-1": {
        type: "work",
        status: "running",
        deps: [],
        title: "Work node",
        attempts: 0,
        maxAttempts: 1,
        retryPolicy: { backoffMs: 1000, onExhaust: "escalate" },
        startedAt: "2026-02-21T08:00:00.000Z",
      },
      "gate-1": {
        type: "gate",
        status: "awaiting_human",
        deps: ["work-1"],
        gateType: "handoff_gate",
        required: true,
        startedAt: "2026-02-21T08:05:00.000Z",
        verificationResult: {
          passed: true,
          checks: [],
          verifiedAt: "2026-02-21T08:05:00.000Z",
          verifiedBy: "agent",
        },
        verificationStrategy: { type: "human", checks: [] },
      },
    },
    edges: [{ from: "work-1", to: "gate-1", type: "hard", condition: "always" }],
    policy: {
      replanBudgetRemaining: 3,
      replanBudgetInitial: 3,
      verifyBudgetRemaining: 3,
      verifyBudgetInitial: 3,
      maxConcurrentAutoChecks: 1,
      immutableRequiredGates: true,
      maxConcurrent: 1,
      priorityMode: "fifo",
      nodeTimeoutMs: 1000,
      graphTimeoutMs: 10000,
    },
    doneCriteria: {
      completionSinkNodeIds: ["gate-1"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: "2026-02-21T00:00:00.000Z",
    updatedAt: "2026-02-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("task graph lifecycle routes", () => {
  let updateCalls: UpdateCall[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    updateCalls = [];

    mockCreateAdminDbClient.mockImplementation(() => ({
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          let recorded = false;
          const chain = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return chain;
            },
            then: (
              onFulfilled?: (value: { data: Array<{ id: unknown }>; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => {
              if (!recorded) {
                recorded = true;
                updateCalls.push({
                  table,
                  payload,
                  filters: { ...filters },
                });
              }
              return Promise.resolve({ data: [{ id: filters.id ?? filters.node_id }], error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };

          return chain;
        },
      }),
    }));

    mockSyncTaskProgressForGraphExecution.mockResolvedValue(undefined);
  });

  test("pause leaves awaiting_human gates untouched", async () => {
    mockGetGraph.mockReturnValue(buildGraph());

    const { POST } = await import("@/app/api/tasks/[id]/graph/pause/route");
    const response = await POST(
      new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/pause`, { method: "POST" }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(response.status).toBe(200);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "graph_nodes",
          payload: { status: "paused" },
          filters: { graph_id: "graph-1", node_id: "work-1" },
        }),
        expect.objectContaining({
          table: "execution_graphs",
          payload: { execution_state: "paused" },
          filters: { id: "graph-1" },
        }),
      ]),
    );
    expect(
      updateCalls.some(
        (call) => call.table === "graph_nodes" && call.filters.node_id === "gate-1",
      ),
    ).toBe(false);
  });

  test("stop leaves awaiting_human gates untouched", async () => {
    mockGetGraph.mockReturnValue(buildGraph());

    const { POST } = await import("@/app/api/tasks/[id]/graph/stop/route");
    const response = await POST(
      new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/stop`, { method: "POST" }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(response.status).toBe(200);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "graph_nodes",
          payload: { status: "stopped" },
          filters: { graph_id: "graph-1", node_id: "work-1" },
        }),
        expect.objectContaining({
          table: "execution_graphs",
          payload: { execution_state: "stopped" },
          filters: { id: "graph-1" },
        }),
        expect.objectContaining({
          table: "tasks",
          payload: expect.objectContaining({ status: "blocked" }),
          filters: { id: TASK_ID, user_id: "local-user-1" },
        }),
      ]),
    );
    expect(
      updateCalls.some(
        (call) => call.table === "graph_nodes" && call.filters.node_id === "gate-1",
      ),
    ).toBe(false);
  });

  test.each(["paused", "stopped"] as const)(
    "resume restores %s human gates to awaiting_human",
    async (executionState) => {
      mockGetGraph.mockReturnValue(
        buildGraph({
          executionState,
          nodes: {
            "work-1": {
              type: "work",
              status: executionState,
              deps: [],
              title: "Work node",
              attempts: 0,
              maxAttempts: 1,
              retryPolicy: { backoffMs: 1000, onExhaust: "escalate" },
              startedAt: "2026-02-21T08:00:00.000Z",
            },
            "gate-1": {
              type: "gate",
              status: executionState,
              deps: ["work-1"],
              gateType: "handoff_gate",
              required: true,
              startedAt: "2026-02-21T08:05:00.000Z",
              verificationResult: {
                passed: true,
                checks: [],
                verifiedAt: "2026-02-21T08:05:00.000Z",
                verifiedBy: "agent",
              },
              verificationStrategy: { type: "human", checks: [] },
            },
          },
        }),
      );

      const { POST } = await import("@/app/api/tasks/[id]/graph/resume/route");
      const response = await POST(
        new NextRequest(`http://localhost/api/tasks/${TASK_ID}/graph/resume`, { method: "POST" }),
        { params: Promise.resolve({ id: TASK_ID }) },
      );

      expect(response.status).toBe(200);
      expect(updateCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "graph_nodes",
            payload: { status: "running" },
            filters: { graph_id: "graph-1", node_id: "work-1" },
          }),
          expect.objectContaining({
            table: "graph_nodes",
            payload: { status: "awaiting_human" },
            filters: { graph_id: "graph-1", node_id: "gate-1" },
          }),
          expect.objectContaining({
            table: "execution_graphs",
            payload: { execution_state: "running" },
            filters: { id: "graph-1" },
          }),
        ]),
      );
      expect(mockSyncTaskProgressForGraphExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: TASK_ID,
          userId: "local-user-1",
          status: "in_progress",
        }),
      );
    },
  );
});

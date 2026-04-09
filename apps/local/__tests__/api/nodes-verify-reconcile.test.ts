/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

const mockAuthorizeGraphMutation = jest.fn();
const mockGetGraph = jest.fn();
const mockGetTask = jest.fn();
const mockUpdateNodeRuntime = jest.fn();
const mockAppendEvent = jest.fn();
const mockCreateAdminDbClient = jest.fn();

jest.mock("@/src/graph/middleware/authz", () => ({
  authorizeGraphMutation: (...args: unknown[]) => mockAuthorizeGraphMutation(...args),
}));

jest.mock("@/src/graph/store", () => ({
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
  updateNodeRuntime: (...args: unknown[]) => mockUpdateNodeRuntime(...args),
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
  GraphVersionConflictError: class MockGraphVersionConflictError extends Error {
    expectedVersion: number;
    actualVersion: number;
    constructor(expectedVersion: number, actualVersion: number) {
      super("version conflict");
      this.expectedVersion = expectedVersion;
      this.actualVersion = actualVersion;
    }
  },
  GraphNodeNotFoundError: class MockGraphNodeNotFoundError extends Error {
    nodeIds: string[];
    constructor(graphId: string, nodeIds: string[]) {
      super(`Missing nodes in graph ${graphId}`);
      this.nodeIds = nodeIds;
    }
  },
}));

jest.mock("@/lib/db", () => ({
  getTask: (...args: unknown[]) => mockGetTask(...args),
  parseFrontmatter: (markdown: string) => {
    const raw = String(markdown || "");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: raw };
    const frontmatter: Record<string, unknown> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      frontmatter[key] = value;
    }
    return { frontmatter, body: match[2] };
  },
}));

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: (...args: unknown[]) => mockCreateAdminDbClient(...args),
}));

jest.mock("@/src/graph/observability", () => ({
  recordGateVerificationResult: jest.fn(),
}));

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  id: string;
};

function buildGraph(status: "awaiting_human" | "passed", extraNodeStatus: "done" | "pending" = "done") {
  return {
    id: "graph-1",
    taskId: TASK_ID,
    graphVersion: 1,
    mode: "SIMPLE",
    nodes: {
      "work-1": {
        type: "work",
        status: extraNodeStatus,
        deps: [],
        title: "Work node",
        attempts: 0,
        maxAttempts: 1,
        retryPolicy: { backoffMs: 1000, onExhaust: "escalate" },
      },
      "gate-1": {
        type: "gate",
        status,
        deps: ["work-1"],
        gateType: "handoff_gate",
        required: true,
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
  };
}

function buildTaskContent(status: string, stage: string) {
  return `---\nstatus: ${status}\nstage: ${stage}\n---\n# Task\n`;
}

describe("/api/tasks/[id]/nodes/[nodeId]/verify reconcile", () => {
  let updateCalls: UpdateCall[] = [];
  let failBlockedReasonOnce = false;

  beforeEach(() => {
    jest.clearAllMocks();
    updateCalls = [];
    failBlockedReasonOnce = false;

    mockAuthorizeGraphMutation.mockResolvedValue({
      ok: true,
      actor: { actorType: "user", actorId: "user-1" },
      task: { id: TASK_ID, project_id: "proj-1" },
      projectId: "proj-1",
    });

    mockUpdateNodeRuntime.mockResolvedValue({
      graphVersion: 2,
      updatedAt: "2026-02-21T08:00:00.000Z",
    });
    mockAppendEvent.mockResolvedValue(undefined);

    mockGetTask.mockResolvedValue({
      id: TASK_ID,
      content: buildTaskContent("blocked", "PROGRESS"),
    });

    mockCreateAdminDbClient.mockImplementation(() => ({
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            updateCalls.push({ table, payload, id });
            if (
              table === "tasks"
              && failBlockedReasonOnce
              && Object.prototype.hasOwnProperty.call(payload, "blocked_reason")
            ) {
              failBlockedReasonOnce = false;
              return {
                data: null,
                error: { code: "42703", message: "column \"blocked_reason\" does not exist" },
              };
            }
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }));
  });

  test("approving final sink gate marks task completed and graph done", async () => {
    mockGetGraph
      .mockResolvedValueOnce(buildGraph("awaiting_human", "done"))
      .mockResolvedValueOnce(buildGraph("passed", "done"));

    const { POST } = await import("@/app/api/tasks/[id]/nodes/[nodeId]/verify/route");
    const request = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/nodes/gate-1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        approved: true,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: TASK_ID, nodeId: "gate-1" }) });
    expect(response.status).toBe(200);

    const taskUpdate = updateCalls.find((call) => call.table === "tasks");
    const graphUpdate = updateCalls.find((call) => call.table === "execution_graphs");

    expect(taskUpdate?.payload.status).toBe("completed");
    expect(taskUpdate?.payload.stage).toBe("DONE");
    expect(String(taskUpdate?.payload.content || "")).toContain("status: completed");
    expect(String(taskUpdate?.payload.content || "")).toContain("stage: DONE");
    expect(graphUpdate?.payload.execution_state).toBe("done");
  });

  test("approving a non-final unblock requeues task and sets graph running", async () => {
    mockGetGraph
      .mockResolvedValueOnce(buildGraph("awaiting_human", "done"))
      .mockResolvedValueOnce(buildGraph("passed", "pending"));

    const { POST } = await import("@/app/api/tasks/[id]/nodes/[nodeId]/verify/route");
    const request = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/nodes/gate-1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        approved: true,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: TASK_ID, nodeId: "gate-1" }) });
    expect(response.status).toBe(200);

    const taskUpdate = updateCalls.find((call) => call.table === "tasks");
    const graphUpdate = updateCalls.find((call) => call.table === "execution_graphs");

    expect(taskUpdate?.payload.status).toBe("queued");
    expect(taskUpdate?.payload.stage).toBe("PROGRESS");
    expect(String(taskUpdate?.payload.content || "")).toContain("status: queued");
    expect(String(taskUpdate?.payload.content || "")).toContain("stage: PROGRESS");
    expect(graphUpdate?.payload.execution_state).toBe("running");
  });

  test("retries task update without blocked_reason when column is missing", async () => {
    failBlockedReasonOnce = true;
    mockGetGraph
      .mockResolvedValueOnce(buildGraph("awaiting_human", "done"))
      .mockResolvedValueOnce(buildGraph("passed", "done"));

    const { POST } = await import("@/app/api/tasks/[id]/nodes/[nodeId]/verify/route");
    const request = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/nodes/gate-1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        approved: true,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: TASK_ID, nodeId: "gate-1" }) });
    expect(response.status).toBe(200);

    const taskCalls = updateCalls.filter((call) => call.table === "tasks");
    expect(taskCalls.length).toBeGreaterThanOrEqual(2);
    expect(taskCalls[0]?.payload).toHaveProperty("blocked_reason");
    expect(taskCalls[1]?.payload).not.toHaveProperty("blocked_reason");
    expect(taskCalls[1]?.payload.status).toBe("completed");
  });
});

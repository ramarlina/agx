/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeGraphMutation = jest.fn();
const mockAppendEvent = jest.fn();
const mockCreateGraph = jest.fn();
const mockGetGraph = jest.fn();
const mockUpdateGraphStructure = jest.fn();
const mockUpdateNodeRuntime = jest.fn();
const mockValidateGraph = jest.fn();

const mockRecordGraphCreate = jest.fn();
const mockRecordReplan = jest.fn();
const mockRecordRollback = jest.fn();
const mockRecordGateVerificationResult = jest.fn();
const mockRecordMigrationFailure = jest.fn();

class MockGraphVersionConflictError extends Error {
  expectedVersion: number;
  actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super("version conflict");
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

class MockGraphNodeNotFoundError extends Error {
  nodeIds: string[];

  constructor(nodeIds: string[]) {
    super("node not found");
    this.nodeIds = nodeIds;
  }
}

jest.mock("@/src/graph/middleware/authz", () => ({
  authorizeGraphMutation: (...args: unknown[]) => mockAuthorizeGraphMutation(...args),
}));

jest.mock("@/src/graph/store", () => ({
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
  createGraph: (...args: unknown[]) => mockCreateGraph(...args),
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
  updateGraphStructure: (...args: unknown[]) => mockUpdateGraphStructure(...args),
  updateNodeRuntime: (...args: unknown[]) => mockUpdateNodeRuntime(...args),
  GraphVersionConflictError: MockGraphVersionConflictError,
  GraphNodeNotFoundError: MockGraphNodeNotFoundError,
  GraphTaskAlreadyBoundError: class MockGraphTaskAlreadyBoundError extends Error {
    taskId: string;
    existingGraphId: string;

    constructor(taskId: string, existingGraphId: string) {
      super("already bound");
      this.taskId = taskId;
      this.existingGraphId = existingGraphId;
    }
  },
}));

jest.mock("@/src/graph/validate", () => ({
  validateGraph: (...args: unknown[]) => mockValidateGraph(...args),
}));

jest.mock("@/src/graph/observability", () => ({
  recordGraphCreate: (...args: unknown[]) => mockRecordGraphCreate(...args),
  recordReplan: (...args: unknown[]) => mockRecordReplan(...args),
  recordRollback: (...args: unknown[]) => mockRecordRollback(...args),
  recordGateVerificationResult: (...args: unknown[]) => mockRecordGateVerificationResult(...args),
  recordMigrationFailure: (...args: unknown[]) => mockRecordMigrationFailure(...args),
}));

function buildValidationResult() {
  return {
    valid: true,
    errors: {
      dag: [],
      depsEdgesConsistency: [],
      requiredGateNonBypass: [],
      conditionalBranchExclusivity: [],
      joinStrategy: [],
    },
    topologicalOrder: [],
  };
}

function buildGraph() {
  return {
    id: "graph-1",
    taskId: "00000000-0000-0000-0000-000000000001",
    graphVersion: 1,
    mode: "PROJECT",
    nodes: {
      "work-1": {
        type: "work",
        status: "pending",
        deps: [],
        title: "Work",
        attempts: 0,
        maxAttempts: 1,
        retryPolicy: { backoffMs: 1_000, onExhaust: "escalate" },
      },
      "gate-1": {
        type: "gate",
        status: "running",
        deps: ["work-1"],
        gateType: "progress",
        required: true,
        verificationStrategy: {
          type: "auto",
          checks: [],
        },
      },
    },
    edges: [
      { from: "work-1", to: "gate-1", type: "hard", condition: "always" },
    ],
    policy: {
      replanBudgetRemaining: 2,
      replanBudgetInitial: 3,
      verifyBudgetRemaining: 4,
      verifyBudgetInitial: 5,
      maxConcurrentAutoChecks: 1,
      immutableRequiredGates: true,
      maxConcurrent: 2,
      priorityMode: "fifo",
      nodeTimeoutMs: 1_000,
      graphTimeoutMs: 10_000,
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["gate-1"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("graph mutation audit events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizeGraphMutation.mockResolvedValue({
      ok: true,
      actor: { actorType: "user", actorId: "user-1" },
      task: { id: "00000000-0000-0000-0000-000000000001", project_id: "proj-1" },
      projectId: "proj-1",
    });
    mockValidateGraph.mockReturnValue(buildValidationResult());
    mockGetGraph.mockResolvedValue(buildGraph());
    mockCreateGraph.mockResolvedValue(buildGraph());
    mockUpdateGraphStructure.mockResolvedValue({
      graphVersion: 2,
      updatedAt: "2026-02-14T00:01:00.000Z",
    });
    mockUpdateNodeRuntime.mockResolvedValue({
      graphVersion: 2,
      updatedAt: "2026-02-14T00:01:00.000Z",
    });
    mockAppendEvent.mockResolvedValue(undefined);
  });

  test("rejects unauthorized create mutation", async () => {
    mockAuthorizeGraphMutation.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const { POST } = await import("@/app/api/tasks/[id]/graph/route");
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
      method: "POST",
      body: JSON.stringify({
        mode: "SIMPLE",
        nodes: {
          "work-1": { type: "work", title: "Work", status: "pending", deps: [] },
        },
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) });
    expect(response.status).toBe(401);
  });

  test("emits graph_created audit event on graph creation", async () => {
    mockGetGraph.mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/tasks/[id]/graph/route");
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
      method: "POST",
      body: JSON.stringify({
        mode: "SIMPLE",
        nodes: {
          "work-1": { type: "work", title: "Work", status: "pending", deps: [] },
        },
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) });
    expect(response.status).toBe(201);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "graph_created" }),
    );
  });

  test("emits replan and budget_consumed audit events", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/graph/replan/route");
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/replan", {
      method: "POST",
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        triggeredAtNodeId: "gate-1",
        reason: "split tasks",
        proposedChanges: {
          estimateDeltas: { "work-1": 5 },
        },
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) });
    expect(response.status).toBe(200);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "replan" }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "budget_consumed", budgetType: "replan" }),
    );
  });

  test("emits rollback audit event", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/graph/rollback/route");
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/rollback", {
      method: "POST",
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        toCheckpoint: "gate-1",
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) });
    expect(response.status).toBe(200);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "rollback" }),
    );
  });

  test("emits node status + gate verification + verify budget events on verify", async () => {
    const { POST } = await import(
      "@/app/api/tasks/[id]/nodes/[nodeId]/verify/route"
    );
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/nodes/gate-1/verify", {
      method: "POST",
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        approved: true,
        checks: [{ check: "tests", passed: true }],
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001", nodeId: "gate-1" }),
    });
    expect(response.status).toBe(200);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "node_status" }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "gate_verification" }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "budget_consumed", budgetType: "verify" }),
    );
  });

  test("emits node status and gate verification events on internal PATCH mutation", async () => {
    mockAuthorizeGraphMutation.mockResolvedValueOnce({
      ok: true,
      actor: { actorType: "service", actorId: "executor-engine" },
      task: { id: "00000000-0000-0000-0000-000000000001", project_id: "proj-1" },
      projectId: "proj-1",
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/graph/route");
    const request = new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
      method: "PATCH",
      body: JSON.stringify({
        ifMatchGraphVersion: 1,
        nodeUpdates: {
          "gate-1": {
            status: "passed",
          },
        },
        budgetUpdates: [
          {
            budgetType: "verify",
            remaining: 3,
            triggerNodeId: "gate-1",
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) });
    expect(response.status).toBe(200);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "node_status" }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "gate_verification" }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({ eventType: "budget_consumed", budgetType: "verify" }),
    );
  });
});

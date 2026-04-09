/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockAuthorizeGraphMutation = jest.fn();
const mockGetGraph = jest.fn();
const mockUpdateNodeRuntime = jest.fn();
const mockUpdateGraphStructure = jest.fn();
const mockAppendEvent = jest.fn();
const mockValidateGraph = jest.fn();

class MockGraphVersionConflictError extends Error {
  expectedVersion: number;
  actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(`Execution graph version conflict: expected ${expectedVersion}, found ${actualVersion}.`);
    this.name = "GraphVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

jest.mock("@/src/graph/middleware/authz", () => ({
  authorizeGraphMutation: (...args: unknown[]) => mockAuthorizeGraphMutation(...args),
}));

jest.mock("@/src/graph/store", () => ({
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
  updateNodeRuntime: (...args: unknown[]) => mockUpdateNodeRuntime(...args),
  updateGraphStructure: (...args: unknown[]) => mockUpdateGraphStructure(...args),
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
  GraphVersionConflictError: MockGraphVersionConflictError,
}));

jest.mock("@/src/graph/validate", () => ({
  validateGraph: (...args: unknown[]) => mockValidateGraph(...args),
}));

jest.mock("@/src/graph/observability", () => ({
  recordGraphCreate: jest.fn(),
  recordReplan: jest.fn(),
  recordRollback: jest.fn(),
  recordGateVerificationResult: jest.fn(),
  recordMigrationFailure: jest.fn(),
}));

jest.mock("@/src/graph/parity", () => ({
  logParityDiff: jest.fn(),
}));

function sampleGraph() {
  return {
    id: "graph-1",
    taskId: "00000000-0000-0000-0000-000000000001",
    graphVersion: 7,
    mode: "PROJECT",
    nodes: {
      "work-1": {
        type: "work",
        status: "pending",
        deps: [],
        title: "Work",
        attempts: 0,
        maxAttempts: 2,
        retryPolicy: { backoffMs: 100, onExhaust: "fail" },
      },
      "checkpoint-gate": {
        type: "gate",
        status: "failed",
        deps: ["work-1"],
        gateType: "quality_gate",
        required: false,
        verificationStrategy: { type: "auto", checks: ["tests_pass"] },
      },
    },
    edges: [
      { from: "work-1", to: "checkpoint-gate", type: "hard" },
    ],
    policy: {
      replanBudgetRemaining: 2,
      replanBudgetInitial: 3,
      verifyBudgetRemaining: 5,
      verifyBudgetInitial: 5,
      maxConcurrentAutoChecks: 1,
      immutableRequiredGates: true,
      maxConcurrent: 2,
      priorityMode: "fifo",
      nodeTimeoutMs: 10000,
      graphTimeoutMs: 86400000,
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["checkpoint-gate"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("ifMatchGraphVersion conflict handling (409)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthorizeGraphMutation.mockResolvedValue({
      ok: true,
      actor: { actorId: "u-1", actorType: "user" },
      projectId: "proj-1",
      task: { id: "00000000-0000-0000-0000-000000000001", status: "in_progress", stage: "execution" },
    });

    mockGetGraph.mockResolvedValue(sampleGraph());
    mockAppendEvent.mockResolvedValue(undefined);
    mockValidateGraph.mockReturnValue({
      valid: true,
      errors: {
        dag: [],
        depsEdgesConsistency: [],
        requiredGateNonBypass: [],
        conditionalBranchExclusivity: [],
        joinStrategy: [],
      },
      topologicalOrder: ["work-1", "checkpoint-gate"],
    });

    const conflict = new MockGraphVersionConflictError(6, 7);
    mockUpdateNodeRuntime.mockRejectedValue(conflict);
    mockUpdateGraphStructure.mockRejectedValue(conflict);
  });

  test("PATCH /graph returns 409 on version mismatch", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/graph/route");

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "PATCH",
        body: JSON.stringify({
          ifMatchGraphVersion: 6,
          nodeUpdates: {
            "work-1": { status: "running" },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.currentGraphVersion).toBe(7);
  });

  test("POST /graph/replan returns 409 on version mismatch", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/graph/replan/route");

    const response = await POST(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/replan", {
        method: "POST",
        body: JSON.stringify({
          ifMatchGraphVersion: 6,
          triggeredAtNodeId: "checkpoint-gate",
          reason: "split work",
          proposedChanges: {},
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.currentGraphVersion).toBe(7);
  });

  test("POST /graph/rollback returns 409 on version mismatch", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/graph/rollback/route");

    const response = await POST(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/rollback", {
        method: "POST",
        body: JSON.stringify({
          ifMatchGraphVersion: 6,
          toCheckpoint: "checkpoint-gate",
          reason: "retry with fix",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.currentGraphVersion).toBe(7);
  });
});

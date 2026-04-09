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

class MockGraphTaskAlreadyBoundError extends Error {
  taskId: string;
  existingGraphId: string;

  constructor(taskId: string, existingGraphId: string) {
    super("already bound");
    this.taskId = taskId;
    this.existingGraphId = existingGraphId;
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
  GraphTaskAlreadyBoundError: MockGraphTaskAlreadyBoundError,
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

function buildGraph(mode: "SIMPLE" | "PROJECT" = "SIMPLE"): any {
  return {
    id: "graph-1",
    taskId: "00000000-0000-0000-0000-000000000001",
    graphVersion: 1,
    mode,
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
    },
    edges: [],
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
      completionSinkNodeIds: ["work-1"],
    },
    versionHistory: [],
    runtimeEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("graph API endpoints", () => {
  let graphState: any;

  beforeEach(() => {
    jest.clearAllMocks();
    graphState = null;

    mockAuthorizeGraphMutation.mockResolvedValue({
      ok: true,
      actor: { actorType: "user", actorId: "user-1" },
      task: { id: "00000000-0000-0000-0000-000000000001", project_id: "proj-1" },
      projectId: "proj-1",
    });

    mockValidateGraph.mockReturnValue(buildValidationResult());
    mockAppendEvent.mockResolvedValue(undefined);

    mockGetGraph.mockImplementation(async () => graphState);
    mockCreateGraph.mockImplementation(async (graph) => {
      graphState = graph;
      return graphState;
    });

    mockUpdateNodeRuntime.mockImplementation(
      async (_graphId: string, nodeUpdates: Record<string, any>, ifMatchGraphVersion: number) => {
        if (!graphState) {
          throw new Error("missing graph");
        }
        if (graphState.graphVersion !== ifMatchGraphVersion) {
          throw new MockGraphVersionConflictError(ifMatchGraphVersion, graphState.graphVersion);
        }

        for (const [nodeId, patch] of Object.entries(nodeUpdates)) {
          const currentNode = graphState.nodes[nodeId];
          if (!currentNode) {
            throw new MockGraphNodeNotFoundError([nodeId]);
          }
          graphState.nodes[nodeId] = {
            ...currentNode,
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.metrics ? { metrics: patch.metrics } : {}),
            ...(patch.output ? { output: patch.output } : {}),
            ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
            ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
            ...(patch.actualMinutes !== undefined ? { actualMinutes: patch.actualMinutes } : {}),
          };
        }

        graphState.updatedAt = "2026-02-14T00:01:00.000Z";
        return { graphVersion: graphState.graphVersion, updatedAt: graphState.updatedAt };
      },
    );

    mockUpdateGraphStructure.mockImplementation(
      async (_graphId: string, update: Record<string, unknown>, ifMatchGraphVersion: number) => {
        if (!graphState) {
          throw new Error("missing graph");
        }
        if (graphState.graphVersion !== ifMatchGraphVersion) {
          throw new MockGraphVersionConflictError(ifMatchGraphVersion, graphState.graphVersion);
        }

        graphState = {
          ...graphState,
          ...(update.mode ? { mode: update.mode } : {}),
          ...(update.nodes ? { nodes: update.nodes } : {}),
          ...(update.edges ? { edges: update.edges } : {}),
          ...(update.policy ? { policy: update.policy } : {}),
          ...(update.doneCriteria ? { doneCriteria: update.doneCriteria } : {}),
          graphVersion: graphState.graphVersion + 1,
          updatedAt: "2026-02-14T00:02:00.000Z",
        };

        return { graphVersion: graphState.graphVersion, updatedAt: graphState.updatedAt };
      },
    );
  });

  test("SIMPLE mode works end-to-end create -> start -> complete", async () => {
    const { POST: createGraphRoute, GET: getGraphRoute } = await import(
      "@/app/api/tasks/[id]/graph/route"
    );
    const { POST: startRoute } = await import(
      "@/app/api/tasks/[id]/nodes/[nodeId]/start/route"
    );
    const { POST: completeRoute } = await import(
      "@/app/api/tasks/[id]/nodes/[nodeId]/complete/route"
    );

    const createResponse = await createGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "POST",
        body: JSON.stringify({
          mode: "SIMPLE",
          nodes: { "work-1": { type: "work", status: "pending", title: "Work", deps: [] } },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    expect(createResponse.status).toBe(201);

    const startResponse = await startRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/nodes/work-1/start", {
        method: "POST",
        body: JSON.stringify({ ifMatchGraphVersion: 1 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001", nodeId: "work-1" }) },
    );
    expect(startResponse.status).toBe(200);

    const completeResponse = await completeRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/nodes/work-1/complete", {
        method: "POST",
        body: JSON.stringify({ ifMatchGraphVersion: 1, output: { ok: true } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001", nodeId: "work-1" }) },
    );
    expect(completeResponse.status).toBe(200);

    const getResponse = await getGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getPayload.graph.mode).toBe("SIMPLE");
    expect(getPayload.graph.nodes["work-1"].status).toBe("done");
  });

  test("PROJECT mode works end-to-end create -> start -> complete", async () => {
    const { POST: createGraphRoute, GET: getGraphRoute } = await import(
      "@/app/api/tasks/[id]/graph/route"
    );
    const { POST: startRoute } = await import(
      "@/app/api/tasks/[id]/nodes/[nodeId]/start/route"
    );
    const { POST: completeRoute } = await import(
      "@/app/api/tasks/[id]/nodes/[nodeId]/complete/route"
    );

    const createResponse = await createGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "POST",
        body: JSON.stringify({
          mode: "PROJECT",
          nodes: { "work-1": { type: "work", status: "pending", title: "Work", deps: [] } },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    expect(createResponse.status).toBe(201);

    const startResponse = await startRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/nodes/work-1/start", {
        method: "POST",
        body: JSON.stringify({ ifMatchGraphVersion: 1 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001", nodeId: "work-1" }) },
    );
    expect(startResponse.status).toBe(200);

    const completeResponse = await completeRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/nodes/work-1/complete", {
        method: "POST",
        body: JSON.stringify({ ifMatchGraphVersion: 1, metrics: { tokensUsed: 10, latencyMs: 200, retryCount: 0 } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001", nodeId: "work-1" }) },
    );
    expect(completeResponse.status).toBe(200);

    const getResponse = await getGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getPayload.graph.mode).toBe("PROJECT");
    expect(getPayload.graph.nodes["work-1"].status).toBe("done");
  });

  test("supports function nodes in create and replan payloads", async () => {
    const { POST: createGraphRoute, GET: getGraphRoute } = await import(
      "@/app/api/tasks/[id]/graph/route"
    );
    const { POST: replanRoute } = await import("@/app/api/tasks/[id]/graph/replan/route");

    const createResponse = await createGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "POST",
        body: JSON.stringify({
          mode: "SIMPLE",
          nodes: {
            "fn-fetch": {
              type: "function",
              status: "pending",
              kind: "mcp",
              title: "Fetch Email",
              command: "gmail.search",
              args: { query: "is:unread" },
              timeoutMs: 15_000,
              deps: [],
            },
            "work-1": { type: "work", status: "pending", title: "Summarize", deps: ["fn-fetch"] },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    expect(createResponse.status).toBe(201);

    const getResponse = await getGraphRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getPayload.graph.nodes["fn-fetch"]).toEqual(
      expect.objectContaining({
        type: "function",
        kind: "mcp",
        command: "gmail.search",
      }),
    );

    const replanResponse = await replanRoute(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/replan", {
        method: "POST",
        body: JSON.stringify({
          ifMatchGraphVersion: 1,
          triggeredAtNodeId: "work-1",
          reason: "add deterministic step",
          proposedChanges: {
            addNodes: {
              "fn-normalize": {
                type: "function",
                kind: "bash",
                title: "Normalize",
                command: "cat inbox.json",
                deps: ["work-1"],
              },
            },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const replanPayload = await replanResponse.json();
    expect(replanResponse.status).toBe(200);
    expect(replanPayload.graphVersion).toBe(2);
    expect(mockUpdateGraphStructure).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        nodes: expect.objectContaining({
          "fn-normalize": expect.objectContaining({
            type: "function",
            kind: "bash",
            command: "cat inbox.json",
          }),
        }),
      }),
      1,
    );
  });

  test("returns 409 with current version on PATCH graph version conflict", async () => {
    graphState = buildGraph("PROJECT");
    graphState.graphVersion = 5;

    mockAuthorizeGraphMutation.mockResolvedValueOnce({
      ok: true,
      actor: { actorType: "service", actorId: "executor-engine" },
      task: { id: "00000000-0000-0000-0000-000000000001", project_id: "proj-1" },
      projectId: "proj-1",
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/graph/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "PATCH",
        body: JSON.stringify({
          ifMatchGraphVersion: 4,
          nodeUpdates: {
            "work-1": { status: "running" },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.currentGraphVersion).toBe(5);
  });

  test("accepts configPatch in node runtime updates", async () => {
    graphState = buildGraph("PROJECT");
    graphState.nodes.root = {
      type: "root",
      status: "done",
      deps: [],
      title: "Root",
      objective: "Old objective",
      graphCreated: true,
      criteria: [],
    };

    const { PATCH } = await import("@/app/api/tasks/[id]/graph/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph", {
        method: "PATCH",
        body: JSON.stringify({
          ifMatchGraphVersion: 1,
          nodeUpdates: {
            root: {
              configPatch: {
                objective: "Updated objective",
              },
            },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.update.graphVersion).toBe(1);
    expect(mockUpdateNodeRuntime).toHaveBeenCalledWith(
      "graph-1",
      expect.objectContaining({
        root: expect.objectContaining({
          configPatch: expect.objectContaining({
            objective: "Updated objective",
          }),
        }),
      }),
      1,
    );
  });

  test("returns 403 on unauthorized mutation", async () => {
    mockAuthorizeGraphMutation.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const { POST } = await import("@/app/api/tasks/[id]/graph/replan/route");
    const response = await POST(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/replan", {
        method: "POST",
        body: JSON.stringify({
          ifMatchGraphVersion: 1,
          triggeredAtNodeId: "work-1",
          reason: "split work",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 when graph does not exist", async () => {
    graphState = null;
    const { GET } = await import("@/app/api/tasks/[id]/graph/route");
    const response = await GET(new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });
    expect(response.status).toBe(404);
  });

  test("returns graph history and metrics", async () => {
    graphState = buildGraph("PROJECT");
    graphState.graphVersion = 3;
    graphState.nodes["work-1"] = {
      ...graphState.nodes["work-1"],
      status: "done",
      metrics: { tokensUsed: 42, latencyMs: 900, retryCount: 1 },
      estimateMinutes: 5,
      actualMinutes: 7,
    };
    graphState.nodes["gate-1"] = {
      type: "gate",
      status: "passed",
      deps: ["work-1"],
      gateType: "quality_gate",
      required: true,
      verificationStrategy: { type: "auto", checks: ["tests"] },
    };
    graphState.versionHistory = [
      {
        eventType: "replan",
        fromVersion: 1,
        toVersion: 2,
        timestamp: "2026-02-14T00:10:00.000Z",
        reason: "split work",
        triggeredBy: "human",
        triggeredAtNodeId: "work-1",
        changes: {
          addedNodes: ["gate-1"],
          removedNodes: [],
          rewiredDeps: [],
          estimateDeltas: { "work-1": 2 },
        },
      },
      {
        eventType: "rollback",
        toCheckpoint: "gate-1",
        timestamp: "2026-02-14T00:12:00.000Z",
        reason: "retry",
        triggeredBy: "human",
      },
    ];

    const { GET: getHistory } = await import("@/app/api/tasks/[id]/graph/history/route");
    const { GET: getMetrics } = await import("@/app/api/tasks/[id]/graph/metrics/route");

    const historyResponse = await getHistory(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/history"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const historyPayload = await historyResponse.json();
    expect(historyResponse.status).toBe(200);
    expect(historyPayload.history).toHaveLength(2);

    const metricsResponse = await getMetrics(
      new NextRequest("http://localhost/api/tasks/00000000-0000-0000-0000-000000000001/graph/metrics"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    );
    const metricsPayload = await metricsResponse.json();
    expect(metricsResponse.status).toBe(200);
    expect(metricsPayload.metrics.totalNodes).toBe(2);
    expect(metricsPayload.metrics.replanCount).toBe(1);
    expect(metricsPayload.metrics.gatePassRate).toBe(1);
  });
});

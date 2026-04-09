/**
 * @jest-environment node
 */

const mockGetGraph = jest.fn();

jest.mock("@/src/graph/store", () => ({
  getGraph: (...args: unknown[]) => mockGetGraph(...args),
}));

describe("graph read path kill-switch", () => {
  const originalMode = process.env.AGX_GRAPH_READ_PATH_MODE;
  const originalKillSwitch = process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.AGX_GRAPH_READ_PATH_MODE = originalMode;
    process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH = originalKillSwitch;
  });

  test("uses v2 projection when read path mode is v2", async () => {
    process.env.AGX_GRAPH_READ_PATH_MODE = "v2";
    process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH = "0";

    mockGetGraph.mockResolvedValue({
      id: "graph-1",
      taskId: "task-1",
      graphVersion: 1,
      mode: "PROJECT",
      nodes: {
        "work-1": {
          type: "work",
          status: "done",
          deps: [],
          title: "Work",
          attempts: 1,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: "escalate" },
        },
        "handoff-gate": {
          type: "gate",
          status: "passed",
          deps: ["work-1"],
          gateType: "handoff_gate",
          required: true,
          verificationStrategy: { type: "human" },
        },
      },
      edges: [{ from: "work-1", to: "handoff-gate", type: "hard" }],
      policy: {
        replanBudgetRemaining: 3,
        replanBudgetInitial: 3,
        verifyBudgetRemaining: 5,
        verifyBudgetInitial: 5,
        maxConcurrentAutoChecks: 1,
        immutableRequiredGates: true,
        maxConcurrent: 1,
        priorityMode: "fifo",
        nodeTimeoutMs: 1000,
        graphTimeoutMs: 2000,
      },
      doneCriteria: {
        allRequiredGatesPassed: true,
        noRunnableOrPendingWork: true,
      },
      versionHistory: [],
      runtimeEvents: [],
      createdAt: "2026-02-14T00:00:00.000Z",
      updatedAt: "2026-02-14T00:10:00.000Z",
    });

    const { projectTaskReadModel } = await import("@/src/graph/read-path");
    const projected = await projectTaskReadModel({
      id: "task-1",
      content: "# Task",
      status: "queued",
      stage: "ideation",
      created_at: "2026-02-14T00:00:00.000Z",
      updated_at: "2026-02-14T00:00:00.000Z",
    });

    expect(projected.status).toBe("completed");
    expect(projected.stage).toBe("DONE");
    expect(projected.read_path_source).toBe("v2");
  });

  test("kill-switch forces v1 compatibility mode", async () => {
    process.env.AGX_GRAPH_READ_PATH_MODE = "v2";
    process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH = "1";

    const { projectTaskReadModel } = await import("@/src/graph/read-path");
    const projected = await projectTaskReadModel({
      id: "task-1",
      content: "# Task",
      status: "in_progress",
      stage: "execution",
      created_at: "2026-02-14T00:00:00.000Z",
      updated_at: "2026-02-14T00:00:00.000Z",
    });

    expect(projected.status).toBe("in_progress");
    expect(projected.stage).toBe("execution");
    expect(projected.read_path_source).toBe("v1");
    expect(mockGetGraph).not.toHaveBeenCalled();
  });

  test("keeps in_progress when graph projection is queued but task is executing", async () => {
    process.env.AGX_GRAPH_READ_PATH_MODE = "v2";
    process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH = "0";

    mockGetGraph.mockResolvedValue({
      id: "graph-2",
      taskId: "task-2",
      graphVersion: 1,
      mode: "SIMPLE",
      nodes: {
        root: {
          type: "root",
          status: "pending",
          deps: [],
          title: "Task Objective",
          objective: "Do the thing",
          graphCreated: false,
          criteria: [],
        },
      },
      edges: [],
      policy: {
        replanBudgetRemaining: 3,
        replanBudgetInitial: 3,
        verifyBudgetRemaining: 5,
        verifyBudgetInitial: 5,
        maxConcurrentAutoChecks: 1,
        immutableRequiredGates: true,
        maxConcurrent: 1,
        priorityMode: "fifo",
        nodeTimeoutMs: 1000,
        graphTimeoutMs: 2000,
      },
      doneCriteria: {
        allRequiredGatesPassed: true,
        noRunnableOrPendingWork: true,
      },
      versionHistory: [],
      runtimeEvents: [],
      createdAt: "2026-02-14T00:00:00.000Z",
      updatedAt: "2026-02-14T00:10:00.000Z",
    });

    const { projectTaskReadModel } = await import("@/src/graph/read-path");
    const projected = await projectTaskReadModel({
      id: "task-2",
      content: "# Task",
      status: "in_progress",
      stage: "ideation",
      created_at: "2026-02-14T00:00:00.000Z",
      updated_at: "2026-02-14T00:10:00.000Z",
    });

    expect(projected.status).toBe("in_progress");
    expect(projected.read_path_source).toBe("v2");
  });

  test("marks task completed when completion sink handoff gate is successful", async () => {
    process.env.AGX_GRAPH_READ_PATH_MODE = "v2";
    process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH = "0";

    mockGetGraph.mockResolvedValue({
      id: "graph-3",
      taskId: "task-3",
      graphVersion: 2,
      mode: "PROJECT",
      nodes: {
        root: {
          type: "root",
          status: "pending",
          deps: [],
          title: "Task Objective",
          objective: "Ship feature",
          graphCreated: true,
          criteria: [],
        },
        "work-1": {
          type: "work",
          status: "failed",
          deps: ["root"],
          title: "Optional branch",
          attempts: 1,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: "escalate" },
        },
        "handoff-gate": {
          type: "gate",
          status: "passed",
          deps: ["root"],
          gateType: "handoff_gate",
          required: true,
          verificationStrategy: { type: "human" },
        },
      },
      edges: [
        { from: "root", to: "work-1", type: "soft" },
        { from: "root", to: "handoff-gate", type: "hard" },
      ],
      policy: {
        replanBudgetRemaining: 3,
        replanBudgetInitial: 3,
        verifyBudgetRemaining: 5,
        verifyBudgetInitial: 5,
        maxConcurrentAutoChecks: 1,
        immutableRequiredGates: true,
        maxConcurrent: 1,
        priorityMode: "fifo",
        nodeTimeoutMs: 1000,
        graphTimeoutMs: 2000,
      },
      doneCriteria: {
        allRequiredGatesPassed: true,
        noRunnableOrPendingWork: false,
        completionSinkNodeIds: ["handoff-gate"],
      },
      versionHistory: [],
      runtimeEvents: [],
      createdAt: "2026-02-14T00:00:00.000Z",
      updatedAt: "2026-02-14T00:10:00.000Z",
    });

    const { projectTaskReadModel } = await import("@/src/graph/read-path");
    const projected = await projectTaskReadModel({
      id: "task-3",
      content: "# Task",
      status: "in_progress",
      stage: "execution",
      created_at: "2026-02-14T00:00:00.000Z",
      updated_at: "2026-02-14T00:10:00.000Z",
    });

    expect(projected.status).toBe("completed");
    expect(projected.stage).toBe("DONE");
    expect(projected.read_path_source).toBe("v2");
  });
});

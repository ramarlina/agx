/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetTask = jest.fn();
const mockAppendRunToIndex = jest.fn().mockResolvedValue(undefined);
const mockBuildTaskContext = jest.fn();
const mockSignTask = jest.fn().mockReturnValue("mock-signature");
const mockWriteAuditLog = jest.fn().mockResolvedValue("audit-id");
const mockCreateServerDbWithRequest = jest.fn();
const mockCreateAdminDb = jest.fn();
const mockGetUser = jest.fn();
const mockSignalWithStartTaskWorkflow = jest.fn();
const mockSignalTaskWorkflow = jest.fn();
const mockStartTaskWorkflow = jest.fn();
const mockGetBoss = jest.fn();
const mockBossSend = jest.fn();
const mockSyncTaskProgressForGraphExecution = jest.fn().mockResolvedValue(undefined);
const mockTaskStatusUpdateQuery = {
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  then: (resolve: (value: { data: any; error: any }) => unknown) =>
    Promise.resolve(resolve({ data: [], error: null })),
};

const mockTasksSelectQuery = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue({ data: [], error: null }),
};

const mockTasksClaimUpdateQuery = {
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue({ data: [], error: null }),
};

const mockTasksSignatureUpdateQuery = {
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockResolvedValue({ data: [], error: null }),
};

const mockSecretsQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { daemon_secret_hash: "secret-hash" }, error: null }),
};

let tasksFromCallCount = 0;

jest.mock("@/lib/auth-mode", () => ({
  LOCAL_USER: {
    id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
    email: "local@agx.board",
  },
}));

jest.mock("@/lib/db-instance", () => ({
  db: {
    getTask: mockGetTask,
    appendRunToIndex: mockAppendRunToIndex,
  },
}));

jest.mock("@/lib/db", () => ({
  parseFrontmatter: jest.fn((content: string) => {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };
    const frontmatter: Record<string, unknown> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return { frontmatter, body: match[2] };
  }),
  resolveTaskConfig: jest.fn((task, config) => ({
    provider: task.provider || config?.provider || "gemini",
    model: task.model || config?.model || "",
    swarm: task.swarm ?? config?.swarm ?? false,
    swarm_models: task.swarm_models || config?.swarm_models || [],
  })),
}));

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: mockCreateAdminDb,
}));

jest.mock("@/lib/task-context", () => ({
  buildTaskContext: mockBuildTaskContext,
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: mockCreateServerDbWithRequest,
}));

jest.mock("@/lib/security", () => ({
  signTask: mockSignTask,
  writeAuditLog: mockWriteAuditLog,
}));

jest.mock("@/lib/queue/boss", () => ({
  getQueue: () => mockGetBoss(),
  QUEUE_NAMES: {
    TASK_PROCESS: "agx.task.process",
    TASK_CLEANUP: "agx.task.cleanup",
  },
}));

jest.mock("@/src/graph/task-lifecycle", () => ({
  syncTaskProgressForGraphExecution: (...args: unknown[]) => mockSyncTaskProgressForGraphExecution(...args),
}));

function setupQueueMocks() {
  tasksFromCallCount = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f" } }, error: null });
  mockBossSend.mockReset();
  mockBossSend.mockResolvedValue(undefined);
  mockGetBoss.mockReset();
  mockGetBoss.mockResolvedValue({ send: mockBossSend });

  mockCreateServerDbWithRequest.mockResolvedValue({
    auth: { getUser: mockGetUser },
    getTask: mockGetTask,
    appendRunToIndex: mockAppendRunToIndex,
    from: jest.fn((table: string) => {
      if (table === "tasks") return mockTaskStatusUpdateQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  });

  mockCreateAdminDb.mockImplementation(() => ({
    from: (table: string) => {
      if (table === "user_secrets") return mockSecretsQueryBuilder;
      const builder =
        tasksFromCallCount === 0
          ? mockTasksSelectQuery
          : tasksFromCallCount === 1
            ? mockTasksClaimUpdateQuery
            : mockTasksSignatureUpdateQuery;
      tasksFromCallCount += 1;
      return builder;
    },
  }));

  mockTasksSelectQuery.limit.mockReset();
  mockTasksSelectQuery.limit.mockResolvedValue({ data: [], error: null });
  mockTasksSelectQuery.neq.mockReset();
  mockTasksSelectQuery.neq.mockReturnThis();

  mockTasksSignatureUpdateQuery.update.mockReset();
  mockTasksSignatureUpdateQuery.update.mockReturnThis();
  mockTasksSignatureUpdateQuery.eq.mockReset();
  mockTasksSignatureUpdateQuery.eq.mockResolvedValue({ data: [], error: null });

  mockTasksClaimUpdateQuery.update.mockReset();
  mockTasksClaimUpdateQuery.update.mockReturnThis();
  mockTasksClaimUpdateQuery.eq.mockReset();
  mockTasksClaimUpdateQuery.eq.mockReturnThis();
  mockTasksClaimUpdateQuery.select.mockReset();
  mockTasksClaimUpdateQuery.select.mockReturnThis();
  mockTasksClaimUpdateQuery.limit.mockReset();
  mockTasksClaimUpdateQuery.limit.mockResolvedValue({ data: [], error: null });

  mockSecretsQueryBuilder.single.mockReset();
  mockSecretsQueryBuilder.single.mockResolvedValue({ data: { daemon_secret_hash: "secret-hash" }, error: null });

  mockBuildTaskContext.mockResolvedValue({
    comments: [],
    learnings: { task: [], project: [], global: [] },
    stage_prompt: null,
    comments_digest: "",
    project_context: null,
  });

  mockSignalTaskWorkflow.mockReset();
  mockStartTaskWorkflow.mockReset();
  mockSyncTaskProgressForGraphExecution.mockReset();
  mockSyncTaskProgressForGraphExecution.mockResolvedValue(undefined);
  mockTaskStatusUpdateQuery.update.mockReset();
  mockTaskStatusUpdateQuery.update.mockReturnThis();
  mockTaskStatusUpdateQuery.eq.mockReset();
  mockTaskStatusUpdateQuery.eq.mockReturnThis();
}

describe("/api/queue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupQueueMocks();
  });

  test("returns next queued task for authenticated user", async () => {
    const task = {
      id: "task-1",
      content: "# Task",
      title: "Task",
      status: "queued",
      stage: "ideation",
      user_id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
      engine: "claude",
      created_at: new Date().toISOString(),
    };

    mockTasksSelectQuery.limit.mockResolvedValueOnce({ data: [task], error: null });
    mockTasksClaimUpdateQuery.limit.mockResolvedValueOnce({ data: [task], error: null });

    const { GET } = await import("@/app/api/queue/route");
    const response = await GET(new NextRequest("http://localhost/api/queue"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.id).toBe("task-1");
  });

  test("returns null task when queue is empty", async () => {
    mockTasksSelectQuery.limit.mockResolvedValueOnce({ data: [], error: null });

    const { GET } = await import("@/app/api/queue/route");
    const response = await GET(new NextRequest("http://localhost/api/queue"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toBeNull();
  });

  test("marks queued task in_progress on pickup even when started_at already exists", async () => {
    const task = {
      id: "task-queued",
      content: "# Task",
      title: "Queued task",
      status: "queued",
      orchestration_status: "awaiting_agent",
      stage: "execution",
      user_id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
      engine: "claude",
      started_at: "2026-02-01T00:00:00.000Z",
      created_at: new Date().toISOString(),
    };

    mockTasksSelectQuery.limit.mockResolvedValueOnce({ data: [task], error: null });

    const { GET } = await import("@/app/api/queue/route");
    const response = await GET(new NextRequest("http://localhost/api/queue"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.id).toBe("task-queued");
    expect(data.task.status).toBe("in_progress");
    expect(mockTasksClaimUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" })
    );
  });

  test("uses graph progress sync for graph-backed tasks", async () => {
    const task = {
      id: "task-graph",
      content: "# Task",
      title: "Graph task",
      status: "queued",
      stage: "INTAKE",
      graph_id: "graph-1",
      user_id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
      engine: "claude",
      started_at: null,
      created_at: new Date().toISOString(),
    };

    mockTasksSelectQuery.limit.mockResolvedValueOnce({ data: [task], error: null });

    const { GET } = await import("@/app/api/queue/route");
    const response = await GET(new NextRequest("http://localhost/api/queue"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.id).toBe("task-graph");
    expect(data.task.stage).toBe("PROGRESS");
    expect(mockSyncTaskProgressForGraphExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-graph",
        userId: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
        status: "in_progress",
      }),
    );
    expect(mockTasksClaimUpdateQuery.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" }),
    );
  });
});

describe("/api/queue/complete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupQueueMocks();
    mockGetTask.mockResolvedValue({
      id: "task-1",
      stage: "ideation",
      content: "---\nstage: ideation\n---\n# Task",
    });
  });

  test("signals Temporal workflow with decision payload", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockBossSend).toHaveBeenCalledWith(
      "agx.task.process",
      expect.objectContaining({
        taskId: "task-1",
        userId: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
        signal: "agentResult",
        payload: expect.objectContaining({ decision: "done", final_result: "success", comment: "success" }),
      })
    );
    expect(data.signaled).toBe(true);
  });

  test("appends run_index entry when provided", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
        run_entry: {
          run_id: "run-123",
          stage: "execute",
          engine: "claude",
          model: "test-model",
          status: "done",
          created_at: "2026-02-08T00:00:00Z",
          artifact_manifest: [{ kind: "artifact", key: "local://host/tmp" }],
        },
        artifact_path: "/tmp/agx/projects/p/t/execute/run-123",
        artifact_host: "my-host",
        artifact_key: "local://my-host/tmp/agx/projects/p/t/execute/run-123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockAppendRunToIndex).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        run_id: "run-123",
        stage: "execute",
        engine: "claude",
        artifact_path: "/tmp/agx/projects/p/t/execute/run-123",
        artifact_host: "my-host",
        artifact_key: "local://my-host/tmp/agx/projects/p/t/execute/run-123",
      })
    );
  });

  test("persists artifact pointer fields when provided", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
        artifact_path: "/tmp/agx/projects/p/t/execute/run-123",
        artifact_host: "my-host",
        artifact_key: "local://my-host/tmp/agx/projects/p/t/execute/run-123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockTaskStatusUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_path: "/tmp/agx/projects/p/t/execute/run-123",
        artifact_host: "my-host",
        artifact_key: "local://my-host/tmp/agx/projects/p/t/execute/run-123",
      })
    );
  });

  test("maps completion log to agent comment payload", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
        log: "[single] acceptance summary",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockBossSend).toHaveBeenCalledWith(
      "agx.task.process",
      expect.objectContaining({
        taskId: "task-1",
        signal: "agentResult",
        payload: expect.objectContaining({ comment: "[single] acceptance summary" }),
      })
    );
  });

  test("passes explicit comments array to agent result payload", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
        comments: ["[single] step 1", "[single] step 2"],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockBossSend).toHaveBeenCalledWith(
      "agx.task.process",
      expect.objectContaining({
        taskId: "task-1",
        signal: "agentResult",
        payload: expect.objectContaining({ comments: ["[single] step 1", "[single] step 2"] }),
      })
    );
  });

  test("returns 500 when workflow signalWithStart fails", async () => {
    mockBossSend.mockRejectedValueOnce(new Error("queue unavailable"));
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "success",
        decision: "done",
        explanation: "Completed",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  test("returns 400 for missing taskId", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test("persists blocked status in DB before signaling workflow", async () => {
    const { POST } = await import("@/app/api/queue/complete/route");
    const request = new NextRequest("http://localhost/api/queue/complete", {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        final_result: "blocked",
        decision: "blocked",
        explanation: "Needs manual intervention",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockTaskStatusUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked", stage: "ideation" })
    );
    expect(mockBossSend).toHaveBeenCalledWith(
      "agx.task.process",
      expect.objectContaining({
        taskId: "task-1",
        signal: "agentResult",
        payload: expect.objectContaining({ decision: "blocked" }),
      })
    );
  });

});

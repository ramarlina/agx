/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockLoadTaskDependencyGraph = jest.fn();

jest.mock("@/lib/auth-mode", () => ({
  LOCAL_USER: { id: "user-1" },
}));

jest.mock("@/lib/dependency-manager", () => ({
  loadTaskDependencyGraph: mockLoadTaskDependencyGraph,
}));

describe("/api/tasks/[id]/dependencies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTaskDependencyGraph.mockResolvedValue({
      depends_on_tasks: [],
      dependent_tasks: [],
    });
  });

  it("returns the dependency graph", async () => {
    const { GET } = await import("@/app/api/tasks/[id]/dependencies/route");
    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1/dependencies"), {
      params: Promise.resolve({ id: "task-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ depends_on_tasks: [], dependent_tasks: [] });
    expect(mockLoadTaskDependencyGraph).toHaveBeenCalledWith("task-1", "user-1");
  });

  it("returns 400 when task id is missing", async () => {
    const { GET } = await import("@/app/api/tasks/[id]/dependencies/route");
    const response = await GET(new NextRequest("http://localhost/api/tasks//dependencies"), {
      params: Promise.resolve({ id: "" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "Task ID is required" });
    expect(mockLoadTaskDependencyGraph).not.toHaveBeenCalled();
  });

  it("returns 500 when loading the graph fails", async () => {
    mockLoadTaskDependencyGraph.mockRejectedValueOnce(new Error("boom"));
    const { GET } = await import("@/app/api/tasks/[id]/dependencies/route");
    const response = await GET(new NextRequest("http://localhost/api/tasks/task-2/dependencies"), {
      params: Promise.resolve({ id: "task-2" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to load dependency graph" });
  });
});

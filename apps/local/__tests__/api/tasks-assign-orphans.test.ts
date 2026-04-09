/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockAssignOrphanTasksToProject = jest.fn();

jest.mock("@/lib/auth-mode", () => ({
  LOCAL_USER: {
    id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
    email: "local@agx.board",
  },
}));

jest.mock("@/lib/db-instance", () => ({
  db: {
    assignOrphanTasksToProject: (...args: unknown[]) => mockAssignOrphanTasksToProject(...args),
  },
}));

describe("/api/tasks/assign-orphans", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 400 when project_id is missing", async () => {
    const { POST } = await import("@/app/api/tasks/assign-orphans/route");
    const request = new NextRequest("http://localhost/api/tasks/assign-orphans", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("project_id");
    expect(mockAssignOrphanTasksToProject).not.toHaveBeenCalled();
  });

  test("assigns orphan tasks and returns updated count", async () => {
    mockAssignOrphanTasksToProject.mockResolvedValue({
      updatedCount: 2,
      taskIds: ["task-1", "task-2"],
    });

    const { POST } = await import("@/app/api/tasks/assign-orphans/route");
    const request = new NextRequest("http://localhost/api/tasks/assign-orphans", {
      method: "POST",
      body: JSON.stringify({ project_id: "proj-1" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updatedCount).toBe(2);
    expect(data.taskIds).toEqual(["task-1", "task-2"]);
    expect(mockAssignOrphanTasksToProject).toHaveBeenCalledWith(
      "proj-1",
      "2c3cc1ca-956d-4b62-b295-4d2d3374103f"
    );
  });

  test("returns 404 when project does not exist", async () => {
    mockAssignOrphanTasksToProject.mockRejectedValue(new Error("Project not found"));

    const { POST } = await import("@/app/api/tasks/assign-orphans/route");
    const request = new NextRequest("http://localhost/api/tasks/assign-orphans", {
      method: "POST",
      body: JSON.stringify({ project_id: "missing-project" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Project not found");
  });
});

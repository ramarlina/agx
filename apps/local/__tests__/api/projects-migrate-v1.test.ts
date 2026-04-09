/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetProjectWithRepos = jest.fn();
const mockGetTasks = jest.fn();
const mockRestoreProjectTasksFromMigration = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();

jest.mock("@/lib/db", () => ({
  getProjectWithRepos: (...args: unknown[]) => mockGetProjectWithRepos(...args),
  getTasks: (...args: unknown[]) => mockGetTasks(...args),
}));

jest.mock("@/src/graph/migration-job", () => ({
  restoreProjectTasksFromMigration: (...args: unknown[]) =>
    mockRestoreProjectTasksFromMigration(...args),
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: (...args: unknown[]) =>
    mockCreateServerDbWithRequest(...args),
}));

describe("/api/projects/[id]/migrate-v1", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
  });

  test("POST restores project tasks from migration backups", async () => {
    mockGetProjectWithRepos.mockResolvedValue({
      id: "project-1",
      slug: "alpha",
      repos: [],
    });
    mockGetTasks.mockResolvedValue([{ id: "task-1" }, { id: "task-2" }]);
    mockRestoreProjectTasksFromMigration.mockResolvedValue({
      projectId: "project-1",
      restored: 2,
      revertedToV1: 2,
      taskIds: ["task-1", "task-2"],
    });

    const { POST } = await import("@/app/api/projects/[id]/migrate-v1/route");
    const request = new NextRequest("http://localhost/api/projects/project-1/migrate-v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "project-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockRestoreProjectTasksFromMigration).toHaveBeenCalledWith({
      projectId: "project-1",
      taskIds: ["task-1", "task-2"],
    });
    expect(data.restored).toBe(2);
    expect(data.revertedToV1).toBe(2);
  });
});

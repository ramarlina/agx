/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetProjectWithRepos = jest.fn();
const mockGetTasks = jest.fn();
const mockBackupProjectTasksForMigration = jest.fn();
const mockRunV1ToV2MigrationJob = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();

jest.mock("@/lib/db", () => ({
  getProjectWithRepos: (...args: unknown[]) => mockGetProjectWithRepos(...args),
  getTasks: (...args: unknown[]) => mockGetTasks(...args),
}));

jest.mock("@/src/graph/migration-job", () => ({
  backupProjectTasksForMigration: (...args: unknown[]) =>
    mockBackupProjectTasksForMigration(...args),
  runV1ToV2MigrationJob: (...args: unknown[]) => mockRunV1ToV2MigrationJob(...args),
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: (...args: unknown[]) =>
    mockCreateServerDbWithRequest(...args),
}));

describe("/api/projects/[id]/migrate-v2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
  });

  test("POST migrates tasks for the selected project", async () => {
    mockGetProjectWithRepos.mockResolvedValue({
      id: "project-1",
      slug: "alpha",
      repos: [],
    });
    mockGetTasks.mockResolvedValue([
      { id: "task-1" },
      { id: "task-2" },
    ]);
    mockRunV1ToV2MigrationJob.mockResolvedValue({
      processed: 2,
      migrated: 1,
      skipped: 1,
      failed: 0,
      activeProcessed: 1,
      completedProcessed: 1,
      tasks: [],
    });
    mockBackupProjectTasksForMigration.mockResolvedValue({
      projectId: "project-1",
      backedUp: 2,
    });

    const { POST } = await import("@/app/api/projects/[id]/migrate-v2/route");
    const request = new NextRequest("http://localhost/api/projects/project-1/migrate-v2", {
      method: "POST",
      body: JSON.stringify({ dryRun: false }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "project-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetProjectWithRepos).toHaveBeenCalledWith("project-1", "user-1");
    expect(mockGetTasks).toHaveBeenCalledWith("user-1", { project: "alpha" });
    expect(mockRunV1ToV2MigrationJob).toHaveBeenCalledWith({
      dryRun: false,
      taskIds: ["task-1", "task-2"],
    });
    expect(mockBackupProjectTasksForMigration).toHaveBeenCalledWith({
      projectId: "project-1",
      taskIds: ["task-1", "task-2"],
    });
    expect(data.processed).toBe(2);
    expect(data.projectSlug).toBe("alpha");
  });

  test("POST returns early when project has no tasks", async () => {
    mockGetProjectWithRepos.mockResolvedValue({
      id: "project-1",
      slug: "alpha",
      repos: [],
    });
    mockGetTasks.mockResolvedValue([]);

    const { POST } = await import("@/app/api/projects/[id]/migrate-v2/route");
    const request = new NextRequest("http://localhost/api/projects/project-1/migrate-v2", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "project-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockRunV1ToV2MigrationJob).not.toHaveBeenCalled();
    expect(data.processed).toBe(0);
    expect(data.dryRun).toBe(true);
  });
});

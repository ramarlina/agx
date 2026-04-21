/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import {
  createProjectObjective,
  readProjectObjectivesWorkspace,
  upsertProjectObjective,
} from "@/lib/project-objectives";

const mockGetProjects = jest.fn();
const mockCreateProject = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();
const mockGetObjectiveRepository = jest.fn();

jest.mock("@/lib/db-instance", () => ({
  db: {
    getProjects: (...args: unknown[]) => mockGetProjects(...args),
    createProject: (...args: unknown[]) => mockCreateProject(...args),
  },
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: (...args: unknown[]) =>
    mockCreateServerDbWithRequest(...args),
}));

jest.mock("@/src/objectives/repository", () => ({
  getObjectiveRepository: (...args: unknown[]) => mockGetObjectiveRepository(...args),
}));

describe("/api/projects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f" } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
    mockGetObjectiveRepository.mockReturnValue({
      hasFiles: () => false,
      readWorkspace: () => ({ objectives: [], activities: [], activityThreads: {} }),
    });
  });

  test("GET returns projects list", async () => {
    mockGetProjects.mockResolvedValue([
      { id: "proj-1", slug: "one", name: "One", metadata: {}, repos: [] },
    ]);

    const { GET } = await import("@/app/api/projects/route");
    const request = new NextRequest("http://localhost/api/projects");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.projects).toHaveLength(1);
    expect(mockGetProjects).toHaveBeenCalledWith(
      "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
      false
    );
  });

  test("GET hydrates objective metadata from frontmatter files when present", async () => {
    const workspace = upsertProjectObjective(
      readProjectObjectivesWorkspace(undefined),
      createProjectObjective({
        id: "objective-1",
        title: "Get 100 visitors daily",
        teamId: "engineering",
        summary: "File-backed summary",
        now: "2026-04-11T18:00:00.000Z",
      })
    );
    mockGetProjects.mockResolvedValue([
      { id: "proj-1", slug: "agx", name: "AGX", metadata: {}, repos: [] },
    ]);
    mockGetObjectiveRepository.mockReturnValue({
      hasFiles: () => true,
      readWorkspace: () => workspace,
    });

    const { GET } = await import("@/app/api/projects/route");
    const request = new NextRequest("http://localhost/api/projects");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.projects[0].metadata.project_objectives_workspace.objectives[0].summary).toBe(
      "File-backed summary"
    );
    expect(mockGetObjectiveRepository).toHaveBeenCalledWith("agx");
  });

  test("POST returns 503 with actionable message when projects schema is missing", async () => {
    mockCreateProject.mockRejectedValue({
      code: "PGRST205",
      message: "Could not find the table 'public.projects' in the schema cache",
    });

    const { POST } = await import("@/app/api/projects/route");
    const request = new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Test Project" }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.code).toBe("SCHEMA_NOT_READY");
    expect(data.error).toContain("Run Db migrations");
  });

  test("POST returns 400 when a repo path is provided without a folder name", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const request = new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Project",
        repos: [{ name: "", path: "/tmp/agx" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      "Folder name is required for repos[0] when a local path is provided"
    );
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

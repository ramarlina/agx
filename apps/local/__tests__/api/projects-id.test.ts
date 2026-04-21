/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import {
  createProjectObjective,
  readProjectObjectivesWorkspace,
  upsertProjectObjective,
} from "@/lib/project-objectives";

const mockGetProjectWithRepos = jest.fn();
const mockUpdateProject = jest.fn();
const mockDeleteProject = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();
const mockGetObjectiveRepository = jest.fn();

jest.mock("@/lib/db-instance", () => ({
  db: {
    getProjectWithRepos: mockGetProjectWithRepos,
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
  },
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: mockCreateServerDbWithRequest,
}));

jest.mock("@/src/objectives/repository", () => ({
  getObjectiveRepository: (...args: unknown[]) => mockGetObjectiveRepository(...args),
}));

describe("/api/projects/[id]", () => {
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

  describe("GET", () => {
    test("returns project hydrated from objective files", async () => {
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
      mockGetProjectWithRepos.mockResolvedValue({
        id: "proj-1",
        name: "Project Alpha",
        slug: "agx",
        description: "",
        metadata: {},
        repos: [],
      });
      mockGetObjectiveRepository.mockReturnValue({
        hasFiles: () => true,
        readWorkspace: () => workspace,
      });

      const { GET } = await import("@/app/api/projects/[id]/route");
      const request = new NextRequest("http://localhost/api/projects/proj-1");
      const response = await GET(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.project.metadata.project_objectives_workspace.objectives[0].summary).toBe(
        "File-backed summary"
      );
      expect(mockGetProjectWithRepos).toHaveBeenCalledWith(
        "proj-1",
        "2c3cc1ca-956d-4b62-b295-4d2d3374103f"
      );
    });
  });

  describe("PATCH", () => {
    test("updates a project and returns payload", async () => {
      const mockProject = {
        id: "proj-1",
        name: "Project Alpha",
        slug: "project-alpha",
        description: "Updated",
        metadata: { stack: "nextjs" },
        ci_cd_info: "GitHub Actions",
        repos: [],
      };
      mockUpdateProject.mockResolvedValue(mockProject);

      const { PATCH } = await import("@/app/api/projects/[id]/route");
      const request = new NextRequest("http://localhost/api/projects/proj-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Project Alpha",
          slug: "project-alpha",
          description: "Updated",
          metadata: { stack: "nextjs" },
          ci_cd_info: "GitHub Actions",
          repos: [{ name: "repo-1", path: "/tmp/repo" }],
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.project).toEqual(mockProject);
      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-1",
        "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
        expect.objectContaining({
          name: "Project Alpha",
          description: "Updated",
          repos: [{ name: "repo-1", path: "/tmp/repo" }],
        })
      );
    });

    test("returns 400 for invalid project id", async () => {
      const { PATCH } = await import("@/app/api/projects/[id]/route");
      const request = new NextRequest("http://localhost/api/projects/invalid", {
        method: "PATCH",
        body: JSON.stringify({ name: "Test" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: " " }) });
      expect(response.status).toBe(400);
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    test("returns 400 when a folder name is provided without a local path", async () => {
      const { PATCH } = await import("@/app/api/projects/[id]/route");
      const request = new NextRequest("http://localhost/api/projects/proj-1", {
        method: "PATCH",
        body: JSON.stringify({
          repos: [{ name: "Backend", path: "" }],
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        "Local path is required for repos[0] when a folder name is provided"
      );
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    test("deletes a project", async () => {
      mockDeleteProject.mockResolvedValue(undefined);

      const { DELETE } = await import("@/app/api/projects/[id]/route");
      const request = new NextRequest("http://localhost/api/projects/proj-1", { method: "DELETE" });
      const response = await DELETE(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDeleteProject).toHaveBeenCalledWith("proj-1", "2c3cc1ca-956d-4b62-b295-4d2d3374103f");
    });
  });
});

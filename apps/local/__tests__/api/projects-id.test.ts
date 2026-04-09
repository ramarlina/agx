/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockUpdateProject = jest.fn();
const mockDeleteProject = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();

jest.mock("@/lib/db-instance", () => ({
  db: {
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
  },
}));

jest.mock("@/lib/db-server", () => ({
  createDbServerClientWithRequest: mockCreateServerDbWithRequest,
}));

describe("/api/projects/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f" } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: { getUser: mockGetUser },
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

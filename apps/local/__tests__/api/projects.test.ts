/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
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

  test("POST returns 400 when a repo path does not exist", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const missingPath = path.join(tmpdir(), `agx-missing-${Date.now()}`);
    const request = new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Project",
        repos: [{ name: "Missing", path: missingPath }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(`Folder path does not exist for repos[0]: ${missingPath}`);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  test("POST accepts a real local directory as a project folder", async () => {
    const repoPath = mkdtempSync(path.join(tmpdir(), "agx-project-repo-"));
    const mockProject = {
      id: "proj-1",
      slug: "test-project",
      name: "Test Project",
      metadata: {},
      repos: [{ id: "repo-1", name: "Repo", path: repoPath }],
    };
    mockCreateProject.mockResolvedValue(mockProject);

    const { POST } = await import("@/app/api/projects/route");
    const request = new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Project",
        repos: [{ name: "Repo", path: repoPath }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.project).toEqual(mockProject);
    expect(mockCreateProject).toHaveBeenCalledWith(
      "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
      expect.objectContaining({
        name: "Test Project",
        repos: [{ name: "Repo", path: repoPath }],
      })
    );
  });

  test("POST accepts a home-relative local directory as a project folder", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "agx-home-"));
    const repoPath = path.join(home, "repo");
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    mkdirSync(repoPath);
    const mockProject = {
      id: "proj-1",
      slug: "test-project",
      name: "Test Project",
      metadata: {},
      repos: [{ id: "repo-1", name: "Repo", path: "~/repo" }],
    };
    mockCreateProject.mockResolvedValue(mockProject);

    try {
      const { POST } = await import("@/app/api/projects/route");
      const request = new NextRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "Test Project",
          repos: [{ name: "Repo", path: "~/repo" }],
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.project).toEqual(mockProject);
      expect(mockCreateProject).toHaveBeenCalledWith(
        "2c3cc1ca-956d-4b62-b295-4d2d3374103f",
        expect.objectContaining({
          repos: [{ name: "Repo", path: "~/repo" }],
        })
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});

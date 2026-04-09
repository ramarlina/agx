/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetProjects = jest.fn();
const mockCreateProject = jest.fn();
const mockCreateServerDbWithRequest = jest.fn();
const mockGetUser = jest.fn();

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

describe("/api/projects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "2c3cc1ca-956d-4b62-b295-4d2d3374103f" } }, error: null });
    mockCreateServerDbWithRequest.mockResolvedValue({
      auth: { getUser: mockGetUser },
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
    expect(mockGetProjects).toHaveBeenCalledWith("2c3cc1ca-956d-4b62-b295-4d2d3374103f");
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
});

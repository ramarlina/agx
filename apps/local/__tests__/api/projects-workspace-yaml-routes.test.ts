/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetProjectWithRepos = jest.fn();
const mockGetProjectWorkspaceEntries = jest.fn();
const mockGetProjectWorkspace = jest.fn();
const mockCreateWorkspaceEntry = jest.fn();
const mockUpdateWorkspaceEntry = jest.fn();
const mockLoggerError = jest.fn();
const mockFormatError = jest.fn((error: unknown) => ({ message: String(error) }));

jest.mock("@/lib/db", () => ({
  getProjectWithRepos: (...args: unknown[]) => mockGetProjectWithRepos(...args),
  getProjectWorkspaceEntries: (...args: unknown[]) => mockGetProjectWorkspaceEntries(...args),
  getProjectWorkspace: (...args: unknown[]) => mockGetProjectWorkspace(...args),
  createWorkspaceEntry: (...args: unknown[]) => mockCreateWorkspaceEntry(...args),
  updateWorkspaceEntry: (...args: unknown[]) => mockUpdateWorkspaceEntry(...args),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    formatError: (...args: unknown[]) => mockFormatError(...args),
  },
}));

describe("workspace YAML routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProjectWithRepos.mockResolvedValue({
      id: "proj-1",
      slug: "agx",
      repos: [],
    });
  });

  describe("GET /api/projects/[id]/workspace/export", () => {
    test("returns YAML attachment without paths", async () => {
      mockGetProjectWorkspaceEntries.mockResolvedValue([
        {
          id: "entry-1",
          project_id: "proj-1",
          category: "repositories",
          name: "backend",
          path: "/Users/test/backend",
          purpose: "Backend API and services",
          sort_order: 0,
          created_at: "2026-04-19T00:00:00.000Z",
          updated_at: "2026-04-19T00:00:00.000Z",
        },
      ]);

      const { GET } = await import("@/app/api/projects/[id]/workspace/export/route");
      const response = await GET(new NextRequest("http://localhost/api/projects/proj-1/workspace/export"), {
        params: Promise.resolve({ id: "proj-1" }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain('filename="workspace-agx.yaml"');
      expect(body).toContain("name: backend");
      expect(body).not.toContain("/Users/test/backend");
      expect(mockGetProjectWithRepos).toHaveBeenCalledWith("proj-1");
    });

    test("returns 404 when the project does not exist", async () => {
      mockGetProjectWithRepos.mockResolvedValueOnce(null);

      const { GET } = await import("@/app/api/projects/[id]/workspace/export/route");
      const response = await GET(new NextRequest("http://localhost/api/projects/missing/workspace/export"), {
        params: Promise.resolve({ id: "missing" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/projects/[id]/workspace/import", () => {
    test("updates matching entries without touching paths and creates new null-path entries", async () => {
      mockGetProjectWorkspaceEntries.mockResolvedValue([
        {
          id: "entry-1",
          project_id: "proj-1",
          category: "repositories",
          name: "backend",
          path: "/Users/test/backend",
          purpose: "Old purpose",
          sort_order: 8,
          created_at: "2026-04-19T00:00:00.000Z",
          updated_at: "2026-04-19T00:00:00.000Z",
        },
      ]);
      mockUpdateWorkspaceEntry.mockResolvedValue({
        id: "entry-1",
        project_id: "proj-1",
        category: "repositories",
        name: "backend",
        path: "/Users/test/backend",
        purpose: "Backend API and services",
        sort_order: 0,
        created_at: "2026-04-19T00:00:00.000Z",
        updated_at: "2026-04-19T00:01:00.000Z",
      });
      mockCreateWorkspaceEntry.mockResolvedValue({
        id: "entry-2",
        project_id: "proj-1",
        category: "docs",
        name: "specs",
        path: null,
        purpose: "Design specs",
        sort_order: 0,
        created_at: "2026-04-19T00:01:00.000Z",
        updated_at: "2026-04-19T00:01:00.000Z",
      });
      mockGetProjectWorkspace.mockResolvedValue({
        repositories: [
          {
            id: "entry-1",
            project_id: "proj-1",
            category: "repositories",
            name: "backend",
            path: "/Users/test/backend",
            purpose: "Backend API and services",
            sort_order: 0,
            created_at: "2026-04-19T00:00:00.000Z",
            updated_at: "2026-04-19T00:01:00.000Z",
          },
        ],
        docs: [
          {
            id: "entry-2",
            project_id: "proj-1",
            category: "docs",
            name: "specs",
            path: null,
            purpose: "Design specs",
            sort_order: 0,
            created_at: "2026-04-19T00:01:00.000Z",
            updated_at: "2026-04-19T00:01:00.000Z",
          },
        ],
      });

      const yaml = `
version: 1
categories:
  - id: repositories
    label: Repositories
  - id: docs
    label: Docs
entries:
  - category: repositories
    name: backend
    purpose: Backend API and services
  - category: docs
    name: specs
    purpose: Design specs
`;

      const { POST } = await import("@/app/api/projects/[id]/workspace/import/route");
      const response = await POST(
        new NextRequest("http://localhost/api/projects/proj-1/workspace/import", {
          method: "POST",
          body: yaml,
          headers: { "Content-Type": "application/x-yaml" },
        }),
        { params: Promise.resolve({ id: "proj-1" }) },
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockUpdateWorkspaceEntry).toHaveBeenCalledWith("proj-1", "entry-1", {
        purpose: "Backend API and services",
        sort_order: 0,
      });
      expect(mockCreateWorkspaceEntry).toHaveBeenCalledWith("proj-1", {
        category: "docs",
        name: "specs",
        path: null,
        purpose: "Design specs",
        sort_order: 0,
      });
      expect(data.summary).toEqual({ created: 1, updated: 1, total: 2 });
      expect(data.workspace.repositories[0].path).toBe("/Users/test/backend");
    });

    test("returns 400 for invalid YAML", async () => {
      const { POST } = await import("@/app/api/projects/[id]/workspace/import/route");
      const response = await POST(
        new NextRequest("http://localhost/api/projects/proj-1/workspace/import", {
          method: "POST",
          body: "version: 1\ncategories: []\nentries:\n  - category: docs\n    name: specs\n    path: /tmp/specs\n",
          headers: { "Content-Type": "application/x-yaml" },
        }),
        { params: Promise.resolve({ id: "proj-1" }) },
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toMatch(/path/i);
      expect(mockCreateWorkspaceEntry).not.toHaveBeenCalled();
      expect(mockUpdateWorkspaceEntry).not.toHaveBeenCalled();
    });
  });
});

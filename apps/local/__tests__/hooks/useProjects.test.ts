/**
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

import { useProjects } from "@/hooks/useProjects";

describe("useProjects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loads projects on mount", async () => {
    const projects = [{ id: "proj-1", slug: "my-project", name: "My Project", metadata: {}, repos: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects }),
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toEqual(projects);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  test("reports error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
      expect(result.current.projects).toEqual([]);
    });
  });

  test("creates project and prepends to list", async () => {
    const initialProjects: any[] = [];
    const createdProject = {
      id: "proj-2",
      slug: "new-proj",
      name: "New Project",
      metadata: {},
      repos: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: initialProjects }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: createdProject }),
      });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createProject({ name: "New Project" });
    });

    expect(result.current.projects[0]).toEqual(createdProject);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "POST",
      })
    );
  });
});

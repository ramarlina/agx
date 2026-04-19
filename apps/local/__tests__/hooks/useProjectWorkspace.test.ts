/**
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

describe("useProjectWorkspace", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loads workspace entries on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspace: {
          repositories: [
            {
              id: "entry-1",
              project_id: "project-1",
              category: "repositories",
              name: "backend",
              path: "/tmp/backend",
              purpose: "Backend service",
              sort_order: 0,
              created_at: "2026-04-19T00:00:00.000Z",
              updated_at: "2026-04-19T00:00:00.000Z",
            },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useProjectWorkspace("project-1"));

    await waitFor(() => {
      expect(result.current.entryCount).toBe(1);
      expect(result.current.workspace.repositories[0].name).toBe("backend");
      expect(result.current.error).toBeNull();
    });
  });

  test("creates an entry and refreshes the workspace", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workspace: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entry: {
            id: "entry-1",
            project_id: "project-1",
            category: "repositories",
            name: "backend",
            path: "/tmp/backend",
            purpose: "Backend service",
            sort_order: 0,
            created_at: "2026-04-19T00:00:00.000Z",
            updated_at: "2026-04-19T00:00:00.000Z",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspace: {
            repositories: [
              {
                id: "entry-1",
                project_id: "project-1",
                category: "repositories",
                name: "backend",
                path: "/tmp/backend",
                purpose: "Backend service",
                sort_order: 0,
                created_at: "2026-04-19T00:00:00.000Z",
                updated_at: "2026-04-19T00:00:00.000Z",
              },
            ],
          },
        }),
      });

    const { result } = renderHook(() => useProjectWorkspace("project-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createEntry({
        category: "repositories",
        name: "backend",
        path: "/tmp/backend",
        purpose: "Backend service",
      });
    });

    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/projects/project-1/workspace", expect.objectContaining({
      method: "POST",
    }));
    expect(result.current.entryCount).toBe(1);
  });
});

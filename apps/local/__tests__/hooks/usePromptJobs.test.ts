/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

import { usePromptJobs } from "@/hooks/usePromptJobs";

describe("usePromptJobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("does not fetch global jobs when project scope is required but unresolved", async () => {
    const { result } = renderHook(() => usePromptJobs(undefined, { requireProjectId: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.jobs).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("fetches project-scoped jobs when project id is available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobs: [{ id: "job-1", name: "Scoped job" }] }),
    });

    const { result } = renderHook(() => usePromptJobs("project-1", { requireProjectId: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.jobs).toEqual([{ id: "job-1", name: "Scoped job" }]);
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/prompt-jobs?projectId=project-1");
  });
});

/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import type { Thread } from "@/lib/storage";
import { useThreadState } from "@/hooks/useThreadState";

const mockUseSearchParams = jest.fn();
const mockListThreads = jest.fn();
const mockCreateThread = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

jest.mock("@/services/threadService", () => ({
  threadService: {
    listThreads: (...args: unknown[]) => mockListThreads(...args),
    createThread: (...args: unknown[]) => mockCreateThread(...args),
    deleteThread: jest.fn(),
    renameThread: jest.fn(),
    saveThreadMessages: jest.fn(),
    updateThreadStatus: jest.fn(),
    updateThreadOutcomeNote: jest.fn(),
    updateMessageThreadStatus: jest.fn(),
    updateMessageOutcomeNote: jest.fn(),
  },
}));

describe("useThreadState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    window.localStorage.clear();
  });

  test("materializes a routed thread id when it is missing from local thread storage", async () => {
    const generalThread: Thread = {
      id: "global",
      title: "General",
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const projectThread: Thread = {
      id: "project-thread-1",
      title: undefined,
      messages: [],
      createdAt: 2,
      updatedAt: 2,
    };

    mockListThreads.mockResolvedValue([generalThread]);
    mockCreateThread.mockResolvedValue(projectThread);

    const { result } = renderHook(() => useThreadState("project-thread-1"));

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe("project-thread-1");
    });

    expect(mockCreateThread).toHaveBeenCalledWith({ id: "project-thread-1" });
    expect(result.current.threads.map((thread) => thread.id)).toContain("project-thread-1");
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import LinearBoard from "@/components/LinearBoard";
import type { LinearIssue } from "@/hooks/useLinearIssues";
import type { LinearRun } from "@/hooks/useLinearRuns";
import { getLinearBoardFiltersStorageKey } from "@/state/linearBoardFilters";

const mockUseLinearConnection = jest.fn();
const mockUseLinearIssues = jest.fn();
const mockUseLinearRuns = jest.fn();

jest.mock("next/dynamic", () => () => {
  return function MockDynamicComponent() {
    return null;
  };
});

jest.mock("@/components/chat-ui/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("@/hooks/useLinearConnection", () => ({
  useLinearConnection: () => mockUseLinearConnection(),
}));

jest.mock("@/hooks/useLinearIssues", () => ({
  useLinearIssues: (...args: unknown[]) => mockUseLinearIssues(...args),
}));

jest.mock("@/hooks/useLinearRuns", () => ({
  useLinearRuns: (...args: unknown[]) => mockUseLinearRuns(...args),
}));

describe("LinearBoard", () => {
  const originalClipboard = navigator.clipboard;
  const originalIntersectionObserver = global.IntersectionObserver;
  const originalFetch = global.fetch;
  const writeText = jest.fn().mockResolvedValue(undefined);

  function createFetchResponse(body: unknown, ok = true) {
    return Promise.resolve({
      ok,
      json: jest.fn().mockResolvedValue(body),
    });
  }

  function mockBoardFetch({
    assignees = [{ id: "user-1", name: "Alex" }],
    statuses = ["Backlog", "Todo", "In Progress"],
    teams = [{ id: "team-1", name: "Core" }],
    cycles = [],
    participants = [],
    projectAgentIds = [],
  }: {
    assignees?: Array<{ id: string; name: string }>;
    statuses?: string[];
    teams?: Array<{ id: string; name: string }>;
    cycles?: Array<{ id: string; number: number; name: string | null; startsAt: string; endsAt: string }>;
    participants?: Array<{ id: string; name: string; color?: string; title?: string }>;
    projectAgentIds?: string[];
  } = {}) {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/linear/options?projectSlug=agx" || url === "/api/linear/options") {
        return createFetchResponse({ assignees, statuses, teams, cycles });
      }

      if (url === "/api/participants") {
        return createFetchResponse(participants);
      }

      if (url === "/api/projects/project-1/agents") {
        return createFetchResponse({
          agents: projectAgentIds.map((agentId) => ({ agent_id: agentId })),
        });
      }

      return createFetchResponse({});
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    global.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];
    } as typeof IntersectionObserver;

    mockUseLinearConnection.mockReturnValue({
      connected: true,
      loading: false,
      user: { name: "Alex", email: "alex@example.com" },
      clis: [],
      mcpConfigured: { codex: true },
      connect: jest.fn(),
      connectWithKey: jest.fn(),
      disconnect: jest.fn(),
      configureMcp: jest.fn(),
      refresh: jest.fn(),
    });

    const issue: LinearIssue = {
      id: "issue-1",
      identifier: "AGX-101",
      title: "Add copy link action",
      url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
      status: "Todo",
      assignee: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
    };

    mockUseLinearIssues.mockReturnValue({
      issues: [issue],
      loading: false,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    mockUseLinearRuns.mockReturnValue({
      runs: [] as LinearRun[],
      loading: false,
      createRun: jest.fn(),
      updateRun: jest.fn(),
    });

    mockBoardFetch();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    global.fetch = originalFetch;
    global.IntersectionObserver = originalIntersectionObserver;
  });

  test("copies the selected issue URL from the ticket list", async () => {
    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/linear/options?projectSlug=agx");
    });

    expect(screen.queryByRole("combobox", { name: "Workspace" })).not.toBeInTheDocument();

    const copyButton = await screen.findByRole("button", { name: "Copy ticket URL" });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "https://linear.app/agx/issue/AGX-101/add-copy-link-action"
      );
    });

    expect(screen.getByRole("button", { name: "Copied ticket URL" })).toBeInTheDocument();
  });

  test("filters issues by multiple assignees and shows the workspace selector when multiple workspaces are available", async () => {
    mockBoardFetch({
      assignees: [
        { id: "user-1", name: "Alex" },
        { id: "user-2", name: "Casey" },
        { id: "user-3", name: "Maya" },
      ],
      statuses: ["Backlog", "Todo", "In Progress"],
      teams: [
        { id: "team-1", name: "Core" },
        { id: "team-2", name: "Growth" },
      ],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    const statusButton = await screen.findByRole("button", { name: "Status" });
    const assigneeButton = await screen.findByRole("button", { name: "Assignee" });
    const workspaceSelect = await screen.findByRole("combobox", { name: "Workspace" });

    fireEvent.click(statusButton);
    fireEvent.click(await screen.findByRole("option", { name: "Todo" }));
    fireEvent.click(await screen.findByRole("option", { name: "In Progress" }));
    fireEvent.click(assigneeButton);
    fireEvent.click(await screen.findByRole("option", { name: "Casey" }));
    fireEvent.click(await screen.findByRole("option", { name: "Maya" }));

    await waitFor(() => {
      expect(mockUseLinearIssues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          statuses: ["Todo", "In Progress"],
          assigneeIds: ["user-2", "user-3"],
        }),
        true,
        expect.objectContaining({ projectSlug: "agx" })
      );
    });

    fireEvent.change(workspaceSelect, { target: { value: "team-2" } });

    await waitFor(() => {
      expect(mockUseLinearIssues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          statuses: ["Todo", "In Progress"],
          assigneeIds: ["user-2", "user-3"],
          teamId: "team-2",
        }),
        true,
        expect.objectContaining({ projectSlug: "agx" })
      );
    });

    expect(window.localStorage.getItem(getLinearBoardFiltersStorageKey("agx"))).toBe(
      JSON.stringify({
        search: "",
        assigneeIds: ["user-2", "user-3"],
        statuses: ["Todo", "In Progress"],
        teamId: "team-2",
        cycleId: "",
      })
    );
  });

  test("restores saved filters on mount", async () => {
    window.localStorage.setItem(
      getLinearBoardFiltersStorageKey("agx"),
      JSON.stringify({
        search: "automation",
        assigneeIds: ["user-2"],
        statuses: ["Todo"],
        teamId: "team-2",
        cycleId: "",
      })
    );

    mockBoardFetch({
      assignees: [
        { id: "user-1", name: "Alex" },
        { id: "user-2", name: "Casey" },
      ],
      statuses: ["Backlog", "Todo", "In Progress"],
      teams: [
        { id: "team-1", name: "Core" },
        { id: "team-2", name: "Growth" },
      ],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    await waitFor(() => {
      expect(mockUseLinearIssues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "automation",
          statuses: ["Todo"],
          assigneeIds: ["user-2"],
          teamId: "team-2",
        }),
        true,
        expect.objectContaining({ projectSlug: "agx" })
      );
    });
  });

  test("refreshes tickets from the toolbar button", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);

    mockUseLinearIssues.mockReturnValue({
      issues: [
        {
          id: "issue-1",
          identifier: "AGX-101",
          title: "Add copy link action",
          url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
          status: "Todo",
          assignee: null,
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ],
      loading: false,
      hasMore: false,
      loadMore: jest.fn(),
      refresh,
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    fireEvent.click(await screen.findByRole("button", { name: /refresh tickets/i }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  test("shows sessions language and removes the old run-now action", async () => {
    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(await screen.findByText("Sessions")).toBeInTheDocument();
    const newSessionButton = await screen.findByRole("button", { name: "New session" });
    expect(newSessionButton).toHaveAttribute(
      "title",
      "Open a fresh chat for this ticket. You can choose or edit the session script in the session details pane."
    );
    expect(screen.queryByText("Run now")).not.toBeInTheDocument();
    expect(await screen.findByText("No previous sessions yet.")).toBeInTheDocument();
  });

  test("shows the scripted session starter on the new session detail view", async () => {
    mockBoardFetch({
      participants: [{ id: "agent-1", name: "Builder" }],
      projectAgentIds: ["agent-1"],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(await screen.findByText("Start a new session for this ticket")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start scripted session" })).toBeInTheDocument();
  });
});

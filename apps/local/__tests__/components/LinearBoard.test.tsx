import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import LinearBoard from "@/components/LinearBoard";
import type { LinearIssue } from "@/hooks/useLinearIssues";
import type { LinearRun } from "@/hooks/useLinearRuns";
import { getLinearBoardFiltersStorageKey } from "@/state/linearBoardFilters";

const mockUseSearchParams = jest.fn();
const mockUsePathname = jest.fn();
const pushMock = jest.fn();
const replaceMock = jest.fn();
const mockUseLinearConnection = jest.fn();
const mockUseLinearIssues = jest.fn();
const mockUseLinearRuns = jest.fn();
const mockUseGroupChat = jest.fn();
const mockUseProcessPolling = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
  usePathname: () => mockUsePathname(),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

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

jest.mock("@/hooks/useGroupChat", () => ({
  useGroupChat: (...args: unknown[]) => mockUseGroupChat(...args),
}));

jest.mock("@/hooks/useProcessPolling", () => ({
  useProcessPolling: (...args: unknown[]) => mockUseProcessPolling(...args),
}));

describe("LinearBoard", () => {
  const originalClipboard = navigator.clipboard;
  const originalIntersectionObserver = global.IntersectionObserver;
  const originalFetch = global.fetch;
  const originalWindowOpen = window.open;
  const writeText = jest.fn().mockResolvedValue(undefined);
  const focusLinearWindow = jest.fn();
  const mockWindowOpen = jest.fn();

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
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/linear/options?projectSlug=agx" || url === "/api/linear/options") {
        return createFetchResponse({ assignees, statuses, teams, cycles });
      }

       if (url === "/api/linear/issues/issue-1" && init?.method === "PATCH") {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
        return createFetchResponse({
          issue: {
            id: "issue-1",
            identifier: "AGX-101",
            title: "Add copy link action",
            url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
            status: body.status ?? "Todo",
            assignee: null,
            updatedAt: "2026-04-09T00:00:00.000Z",
          },
        });
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

    mockWindowOpen.mockReset();
    focusLinearWindow.mockReset();
    mockWindowOpen.mockReturnValue({ focus: focusLinearWindow });
    Object.defineProperty(window, "open", {
      configurable: true,
      value: mockWindowOpen,
    });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockUsePathname.mockReturnValue("/projects/agx/linear");
    pushMock.mockReset();
    replaceMock.mockReset();

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
      updateIssue: jest.fn(),
    });

    mockUseLinearRuns.mockReturnValue({
      runs: [] as LinearRun[],
      loading: false,
      createRun: jest.fn(),
      updateRun: jest.fn(),
    });

    mockUseGroupChat.mockReturnValue({
      messages: [],
      setMessages: jest.fn(),
      sendMessage: jest.fn(),
      loadHistory: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
      chatRuns: [],
    });

    mockUseProcessPolling.mockReturnValue({
      processes: [],
      streaming: {},
      chatRuns: [],
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
    Object.defineProperty(window, "open", {
      configurable: true,
      value: originalWindowOpen,
    });
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

    expect(
      JSON.parse(window.localStorage.getItem(getLinearBoardFiltersStorageKey("agx")) ?? "{}")
    ).toMatchObject({
      search: "",
      assigneeIds: ["user-2", "user-3"],
      statuses: ["Todo", "In Progress"],
      teamId: "team-2",
      cycleId: "",
      sortBy: "activity",
      sortDir: "desc",
      hasActivity: false,
    });
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
      updateIssue: jest.fn(),
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    fireEvent.click(await screen.findByRole("button", { name: /refresh tickets/i }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  test("shows the TicketPanel with the scripted session action for the selected issue", async () => {
    mockBoardFetch({
      participants: [{ id: "agent-1", name: "Builder" }],
      projectAgentIds: ["agent-1"],
    });
    mockUseSearchParams.mockReturnValue(new URLSearchParams("issue=issue-1"));

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(await screen.findByRole("button", { name: "Start scripted session" })).toBeInTheDocument();
    expect(screen.queryByText("Run now")).not.toBeInTheDocument();
    expect(await screen.findByText("No sessions yet. Start one below.")).toBeInTheDocument();
  });

  test("opens the selected ticket in a new browser tab from the row action", async () => {
    mockBoardFetch({
      participants: [{ id: "agent-1", name: "Builder" }],
      projectAgentIds: ["agent-1"],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    const popoutButton = await screen.findByRole("button", {
      name: "Open this Linear ticket in a new tab",
    });

    expect(popoutButton).toHaveAttribute(
      "title",
      "Open this Linear ticket in a new tab"
    );

    fireEvent.click(popoutButton);

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
      "_blank",
      "noopener,noreferrer"
    );
    expect(focusLinearWindow).toHaveBeenCalledTimes(1);
  });

  test("labels plain chat sessions as ready instead of success", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("issue=issue-1&run=run-1"));

    mockUseLinearRuns.mockReturnValue({
      runs: [
        {
          id: "run-1",
          projectId: "project-1",
          projectSlug: "agx",
          issueId: "issue-1",
          issueIdentifier: "AGX-101",
          issueTitle: "Add copy link action",
          issueStatus: "Todo",
          issueAssignee: null,
          threadId: "thread-1",
          rootMessageId: "root-1",
          chatRunId: "chat-run-1",
          agentId: "agent-1",
          agentName: "Builder",
          mode: "chat",
          sessionTitle: "Investigate the copy-link bug in the ticket sidebar",
          status: "success",
          durationMs: 256600,
          lastError: null,
          startedAt: "2026-04-09T09:48:00.000Z",
          updatedAt: "2026-04-09T09:52:16.600Z",
          completedAt: "2026-04-09T09:52:16.600Z",
        },
      ] as LinearRun[],
      loading: false,
      createRun: jest.fn(),
      updateRun: jest.fn(),
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(
      await screen.findAllByText("Investigate the copy-link bug in the ticket sidebar")
    ).not.toHaveLength(0);
    await screen.findAllByText("ready");
    expect(screen.queryByText("success")).not.toBeInTheDocument();
  });

  test("updates the selected ticket status through the clickable status control", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("issue=issue-1"));

    const refresh = jest.fn().mockResolvedValue(undefined);
    const updateIssue = jest.fn();

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
      updateIssue,
    });

    mockBoardFetch({
      participants: [{ id: "agent-1", name: "Builder" }],
      projectAgentIds: ["agent-1"],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    fireEvent.change(await screen.findByRole("combobox", { name: "Ticket status" }), {
      target: { value: "In Progress" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/linear/issues/issue-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "In Progress" }),
        })
      );
    });

    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "issue-1", status: "In Progress" })
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  test("does not auto-select the first issue when the URL has no issue param", async () => {
    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(await screen.findByText("Select a ticket from the list.")).toBeInTheDocument();
  });

  test("uses the issue query param as the selected ticket", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("issue=issue-1"));
    mockBoardFetch({
      participants: [{ id: "agent-1", name: "Builder" }],
      projectAgentIds: ["agent-1"],
    });

    render(<LinearBoard projectId="project-1" projectSlug="agx" />);

    expect(
      await screen.findByRole("button", { name: "Start scripted session" })
    ).toBeInTheDocument();
  });
});

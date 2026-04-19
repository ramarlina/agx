import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToolPathsSection } from "@/components/projects/home/ToolPathsSection";
import { useTerminalTabsStore } from "@/state/terminalTabs";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

jest.mock("@/hooks/useTrackerConnection", () => ({
  useTrackerConnection: () => ({
    connected: false,
    loading: false,
    user: null,
    clis: { claude: false, codex: false, gemini: false },
    mcpConfigured: {},
    connect: jest.fn(),
    connectWithKey: jest.fn(),
    disconnect: jest.fn(),
    configureMcp: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe("ToolPathsSection", () => {
  beforeEach(() => {
    pushMock.mockReset();
    localStorage.clear();
    useTerminalTabsStore.setState({ sessions: {} });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ threads: {}, total: 0 }),
    } as Response);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("shows an honest empty state when a project has no persisted terminal sessions", async () => {
    render(
      <ToolPathsSection
        projectId="project-1"
        projectSlug="alpha"
        primaryThreadId={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    });

    expect(screen.queryByText(/saved session/i)).not.toBeInTheDocument();
  });

  test("summarizes persisted terminal sessions using the project slug key", async () => {
    useTerminalTabsStore.setState({
      sessions: {
        alpha: [
          {
            id: "session-1",
            title: "Setup shell",
            createdAt: 100,
            terminals: [
              {
                id: "terminal-1",
                title: "Terminal 1",
                createdAt: 100,
                status: "active",
                colSpan: 1,
                rowSpan: 1,
              },
            ],
          },
          {
            id: "session-2",
            title: "Debug shell",
            createdAt: 200,
            terminals: [
              {
                id: "terminal-2",
                title: "Terminal 1",
                createdAt: 200,
                status: "active",
                colSpan: 1,
                rowSpan: 1,
              },
            ],
          },
        ],
        "project-1": [
          {
            id: "wrong-key-session",
            title: "Wrong key",
            createdAt: 999,
            terminals: [
              {
                id: "terminal-3",
                title: "Terminal 1",
                createdAt: 999,
                status: "active",
                colSpan: 1,
                rowSpan: 1,
              },
            ],
          },
        ],
      },
    });

    render(
      <ToolPathsSection
        projectId="project-1"
        projectSlug="alpha"
        primaryThreadId={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("2 saved sessions")).toBeInTheDocument();
    });

    expect(screen.getByText("Latest: Debug shell")).toBeInTheDocument();
    expect(screen.queryByText("1 saved session")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Terminal/i }));
    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/terminal");
  });
});

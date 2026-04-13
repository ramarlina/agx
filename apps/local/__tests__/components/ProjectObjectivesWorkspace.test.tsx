import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectWithRepos } from "@/hooks/useProjects";
import { useProjects } from "@/hooks/useProjects";
import { useGroupChat } from "@/hooks/useGroupChat";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import { threadService } from "@/services/threadService";
import {
  ProjectObjectiveDetail,
  ProjectObjectivesOverview,
} from "@/components/projects/ProjectObjectivesWorkspace";
import {
  addObjectiveActivity,
  appendObjectiveActivityThreadMessage,
  createManualObjectiveActivity,
  createObjectiveActivityThreadMessage,
  createProjectObjective,
  readProjectObjectivesWorkspace,
  removeProjectObjective,
  upsertProjectObjective,
  writeProjectObjectivesWorkspace,
} from "@/lib/project-objectives";

jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock("@/hooks/useProjects", () => ({
  useProjects: jest.fn(),
}));

jest.mock("@/hooks/useGroupChat", () => ({
  useGroupChat: jest.fn(),
}));

jest.mock("@/hooks/useProcessPolling", () => ({
  useProcessPolling: jest.fn(),
}));

jest.mock("@/services/threadService", () => ({
  threadService: {
    createThread: jest.fn(),
  },
}));

jest.mock("@/components/chat-ui/Composer", () => ({
  Composer: ({
    placeholder,
    onSend,
    onStop,
    loading,
    sendInterruptsBusy,
  }: {
    placeholder?: string;
    onSend?: (message: string, maxRounds: number) => Promise<void> | void;
    onStop?: () => void;
    loading?: boolean;
    sendInterruptsBusy?: boolean;
  }) => (
    <div data-testid="objective-chat-composer">
      <span>{placeholder ?? "composer"}</span>
      {loading && !sendInterruptsBusy ? (
        <button type="button" data-testid="objective-chat-stop" onClick={() => onStop?.()}>
          Stop
        </button>
      ) : onSend ? (
        <button type="button" data-testid="objective-chat-send" onClick={() => void onSend("Test objective chat", 10)}>
          Send
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock("@/components/chat-ui/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("@/components/RichTextEditor", () => ({
  __esModule: true,
  default: ({
    content,
    editable,
    onChange,
    placeholder,
  }: {
    content: string;
    editable?: boolean;
    onChange?: (markdown: string) => void;
    placeholder?: string;
  }) =>
    editable ? (
      <textarea
        aria-label={placeholder ?? "Rich text editor"}
        value={content}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ) : (
      <div>{content || placeholder || ""}</div>
    ),
}));

jest.mock("@/components/projects/ObjectiveScheduledTasksPanel", () => ({
  ObjectiveScheduledTasksPanel: ({
    objectiveKey,
  }: {
    objectiveKey?: string;
  }) => (
    <div data-testid="objective-scheduled-tasks-panel">
      <span>Scheduled Tasks</span>
      <span>{objectiveKey ?? "objective-board"}</span>
      <span>Weekly objective review</span>
      <span>Review progress against the objective and propose the next best move.</span>
    </div>
  ),
}));

const mockedUseProjects = jest.mocked(useProjects);
const mockedUseGroupChat = jest.mocked(useGroupChat);
const mockedUseProcessPolling = jest.mocked(useProcessPolling);
const mockedThreadService = jest.mocked(threadService);
const updateProjectMock = jest.fn();
const confirmMock = jest.fn();
const fetchMock = jest.fn();

const teamsResponse = {
  teams: [
    { id: "team-growth", name: "Growth" },
    { id: "team-product", name: "Product" },
  ],
};

function buildProject({
  objectiveThreadId = "thread-objective_growth",
  chatSessionVersion,
}: {
  objectiveThreadId?: string | null;
  chatSessionVersion?: number;
} = {}): ProjectWithRepos {
  const objective = createProjectObjective({
    id: "objective_growth",
    title: "Get 50 visitors daily",
    teamId: "team-growth",
    threadId: objectiveThreadId,
    chatSessionVersion,
    scheduledTaskIds: ["job-objective-growth"],
    summary: "Focus on referral traffic first.",
    cadence: "Every weekday morning",
    progress: 42,
    status: "at_risk",
    now: "2026-04-09T12:00:00.000Z",
  });

  let workspace = upsertProjectObjective(
    readProjectObjectivesWorkspace(undefined),
    objective
  );
  workspace = addObjectiveActivity(
    workspace,
    createManualObjectiveActivity({
      id: "activity_referral_update",
      objectiveId: objective.id,
      title: "Referral CTA refreshed",
      body: "Traffic quality is improving.",
      now: "2026-04-09T13:00:00.000Z",
    })
  );
  workspace = appendObjectiveActivityThreadMessage(
    workspace,
    createObjectiveActivityThreadMessage({
      id: "message-1",
      activityId: "activity_referral_update",
      body: "Need one more variant",
      now: "2026-04-09T13:15:00.000Z",
    })
  );

  return {
    id: "project-1",
    name: "Alpha",
    slug: "alpha",
    description: "",
    metadata: writeProjectObjectivesWorkspace({}, workspace),
    created_at: "2026-04-09T11:00:00.000Z",
    updated_at: "2026-04-09T13:15:00.000Z",
    repos: [],
  };
}

describe("ProjectObjectivesWorkspace", () => {
  beforeEach(() => {
    pushMock.mockReset();
    updateProjectMock.mockReset();
    updateProjectMock.mockResolvedValue(buildProject());
    confirmMock.mockReset();
    confirmMock.mockReturnValue(true);
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: confirmMock,
    });
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: fetchMock,
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
    mockedThreadService.createThread.mockReset();
    mockedThreadService.createThread.mockResolvedValue({
      id: "objective-chat:objective_growth",
      title: "Get 50 visitors daily",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              {
                id: "job-objective-growth",
                name: "Weekly objective review",
                prompt: "Review progress against the objective and propose the next best move.",
                agentId: "agent-growth",
                projectId: "project-1",
                provider: "claude",
                model: "sonnet",
                cliArgs: "",
                cronExpr: "0 9 * * 1-5",
                cadence: "Every weekday morning",
                state: "active",
                overlapPolicy: "skip",
                catchUpPolicy: "fire_once",
                cancelCheckSec: 15,
                condition: "",
                nextRunAt: Date.parse("2026-04-10T09:00:00.000Z"),
                lastRunAt: Date.parse("2026-04-09T09:00:00.000Z"),
                lastOutcome: "success",
                createdAt: "2026-04-09T08:00:00.000Z",
                updatedAt: "2026-04-09T09:05:00.000Z",
              },
            ],
          }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [
              {
                id: "linear-1",
                identifier: "AGX-42",
                title: "Experiment with referral CTA variants",
                url: "https://linear.app/agx/issue/AGX-42",
                status: "Backlog",
                assignee: "Ari",
                updatedAt: "2026-04-09T13:30:00.000Z",
                labels: ["get-50-visitors-daily"],
              },
            ],
          }),
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({ agents: [] }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    mockedUseGroupChat.mockReturnValue({
      messages: [],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: jest.fn(),
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });
    mockedUseProcessPolling.mockReturnValue({
      activeAgents: [],
      processes: [],
      streaming: {},
      chatRuns: [],
      poll: jest.fn(),
    });

    mockedUseProjects.mockReturnValue({
      projects: [buildProject()],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      createProject: jest.fn(),
      updateProject: updateProjectMock,
      deleteProject: jest.fn(),
    });
  });

  test("keeps the root view focused on the objective list", () => {
    render(<ProjectObjectivesOverview projectSlug="alpha" />);

    expect(screen.getByText(/1 activity · Last Apr 9,/i)).toBeInTheDocument();
    expect(screen.queryByText("Focus on referral traffic first.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Get 50 visitors daily/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open details for Get 50 visitors daily/i })
    ).toHaveAttribute("href", "/projects/alpha/objectives/objective_growth");
    expect(screen.queryByText("Activity timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual tasks")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete objective/i })).not.toBeInTheDocument();
  });

  test("keeps objective creation minimal", () => {
    render(<ProjectObjectivesOverview projectSlug="alpha" />);

    fireEvent.click(screen.getByRole("button", { name: /New objective/i }));

    const dialog = screen.getByRole("dialog", { name: /New objective/i });

    expect(within(dialog).getByText("Objective statement")).toBeInTheDocument();
    expect(within(dialog).getByText("Team")).toBeInTheDocument();
    expect(within(dialog).getByText("Notes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Cadence")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Health")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Progress \(/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Create objective/i })).toBeInTheDocument();
  });

  test("keeps objective editing free of progress and health controls", async () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edit objective Get 50 visitors daily/i })
    );

    const dialog = screen.getByRole("dialog", { name: /Edit objective/i });
    expect(within(dialog).getByText("Objective statement")).toBeInTheDocument();
    expect(within(dialog).getByText("Notes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Team")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Schedule")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Health")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Progress \(/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Save objective/i })).toBeInTheDocument();
  });

  test("opens a dedicated team editor", async () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edit team for Get 50 visitors daily/i })
    );

    const dialog = screen.getByRole("dialog", { name: /Edit team/i });
    expect(within(dialog).getByText("Team")).toBeInTheDocument();
    expect(within(dialog).queryByText("Objective statement")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Notes")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Schedule")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Save team/i })).toBeInTheDocument();
  });

  test("lets you delete an objective from the detail view", async () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Delete objective Get 50 visitors daily/i })
    );

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledWith('Delete "Get 50 visitors daily"?');
    expect(pushMock).toHaveBeenCalledWith("/projects/alpha");

    const [, payload] = updateProjectMock.mock.calls[0] as [
      string,
      { metadata: Record<string, unknown> }
    ];
    const expectedWorkspace = removeProjectObjective(
      readProjectObjectivesWorkspace(buildProject().metadata),
      "objective_growth"
    );

    expect(readProjectObjectivesWorkspace(payload.metadata)).toEqual(expectedWorkspace);
  });

  test("uses the simplified objective detail layout", async () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(
      screen.getByRole("link", { name: /Back to objectives/i })
    ).toHaveAttribute("href", "/projects/alpha");
    expect(
      screen.getByText("How often agents should wake up and work on it?")
    ).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    await screen.findByText("Growth");
    expect(screen.getAllByText("Every weekday morning").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Edit team for Get 50 visitors daily/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Edit cadence for Get 50 visitors daily/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Condition")).not.toBeInTheDocument();
    expect(screen.getByText("Scheduled Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Manual Tasks")).not.toBeInTheDocument();
    expect(screen.getByText("Linear Tickets")).toBeInTheDocument();
    expect(screen.getByTestId("objective-chat-composer")).toBeInTheDocument();
    expect(screen.getByTestId("objective-scheduled-tasks-panel")).toBeInTheDocument();
    expect(screen.getByText("Weekly objective review")).toBeInTheDocument();
    expect(
      screen.getByText("Review progress against the objective and propose the next best move.")
    ).toBeInTheDocument();
    await screen.findByText("AGX-42");
    expect(screen.getAllByText("get-50-visitors-daily").length).toBeGreaterThan(0);
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Cadence")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Referral CTA refreshed")).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: /Resize objective chat panel/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete objective Get 50 visitors daily/i })
    ).toBeInTheDocument();
  });

  test("opens a strategy session from the list and shows its saved replies", async () => {
    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-1",
          role: "user",
          participantId: null,
          content: "How should we get there?",
          timestamp: Date.parse("2026-04-10T04:23:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-1",
          role: "assistant",
          participantId: "agent-growth",
          content: "Start with referral experiments and measure conversion weekly.",
          timestamp: Date.parse("2026-04-10T04:24:00.000Z"),
          rootMessageId: "user-1",
          parentMessageId: "user-1",
          depth: 1,
        },
      ],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: jest.fn(),
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "agent-growth",
              name: "Growth Agent",
              provider: "claude",
              model: "sonnet",
              color: "#22c55e",
            },
          ],
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({
            agents: [{ agent_id: "agent-growth", routing_order: 0 }],
          }),
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({ jobs: [] }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [],
          }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(
      screen.getByRole("button", { name: /How should we get there\?/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Start with referral experiments and measure conversion weekly.")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /How should we get there\?/i }));

    expect(screen.getAllByText("How should we get there?").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Start with referral experiments and measure conversion weekly.")
    ).toBeInTheDocument();
  });

  test("starts on the strategy session list and lets you open a session detail view", async () => {
    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-older",
          role: "user",
          participantId: null,
          content: "What should our first growth bet be?",
          timestamp: Date.parse("2026-04-10T03:00:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-older",
          role: "assistant",
          participantId: "agent-growth",
          content: "Test referral loops first.",
          timestamp: Date.parse("2026-04-10T03:05:00.000Z"),
          rootMessageId: "user-older",
          parentMessageId: "user-older",
          depth: 1,
        },
        {
          id: "user-latest",
          role: "user",
          participantId: null,
          content: "How should we operationalize this?",
          timestamp: Date.parse("2026-04-10T05:00:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-latest",
          role: "assistant",
          participantId: "agent-growth",
          content: "Set a weekday review cadence and create two execution tickets.",
          timestamp: Date.parse("2026-04-10T05:05:00.000Z"),
          rootMessageId: "user-latest",
          parentMessageId: "user-latest",
          depth: 1,
        },
      ],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: jest.fn(),
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "agent-growth",
              name: "Growth Agent",
              provider: "claude",
              model: "sonnet",
              color: "#22c55e",
            },
          ],
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({
            agents: [{ agent_id: "agent-growth", routing_order: 0 }],
          }),
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({ jobs: [] }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [],
          }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(
      screen.getByRole("button", { name: /How should we operationalize this\?/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /What should our first growth bet be\?/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Set a weekday review cadence and create two execution tickets.")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /How should we operationalize this\?/i })
    );

    expect(screen.getAllByText("How should we operationalize this?").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Set a weekday review cadence and create two execution tickets.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Test referral loops first.")).not.toBeInTheDocument();
  });

  test("keeps the selected strategy session open during background objective refreshes", async () => {
    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-1",
          role: "user",
          participantId: null,
          content: "How should we get there?",
          timestamp: Date.parse("2026-04-10T04:23:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-1",
          role: "assistant",
          participantId: "agent-growth",
          content: "Start with referral experiments and measure conversion weekly.",
          timestamp: Date.parse("2026-04-10T04:24:00.000Z"),
          rootMessageId: "user-1",
          parentMessageId: "user-1",
          depth: 1,
        },
      ],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: jest.fn(),
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "agent-growth",
              name: "Growth Agent",
              provider: "claude",
              model: "sonnet",
              color: "#22c55e",
            },
          ],
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({
            agents: [{ agent_id: "agent-growth", routing_order: 0 }],
          }),
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({ jobs: [] }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [],
          }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    mockedUseProjects
      .mockReturnValueOnce({
        projects: [buildProject()],
        isLoading: false,
        error: null,
        refetch: jest.fn(),
        createProject: jest.fn(),
        updateProject: updateProjectMock,
        deleteProject: jest.fn(),
      })
      .mockReturnValueOnce({
        projects: [buildProject()],
        isLoading: true,
        error: null,
        refetch: jest.fn(),
        createProject: jest.fn(),
        updateProject: updateProjectMock,
        deleteProject: jest.fn(),
      });

    const { rerender } = render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /How should we get there\?/i }));

    expect(
      screen.getByText("Start with referral experiments and measure conversion weekly.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to sessions/i })).toBeInTheDocument();

    rerender(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(
      screen.getByText("Start with referral experiments and measure conversion weekly.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to sessions/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading objective...")).not.toBeInTheDocument();
  });

  test("list-view composer starts a new session and detail-view composer continues the selected session", async () => {
    const sendMessageMock = jest.fn().mockResolvedValue("user-fresh");
    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-session-1",
          role: "user",
          participantId: null,
          content: "How should we get there?",
          timestamp: Date.parse("2026-04-10T04:23:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-session-1",
          role: "assistant",
          participantId: "agent-growth",
          content: "Start with referral experiments and measure conversion weekly.",
          timestamp: Date.parse("2026-04-10T04:24:00.000Z"),
          rootMessageId: "user-session-1",
          parentMessageId: "user-session-1",
          depth: 1,
        },
      ],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: sendMessageMock,
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "agent-growth",
              name: "Growth Agent",
              provider: "claude",
              model: "sonnet",
              color: "#22c55e",
            },
          ],
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({
            agents: [{ agent_id: "agent-growth", routing_order: 0 }],
          }),
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({ jobs: [] }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [],
          }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(screen.getByTestId("objective-chat-send"));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock.mock.calls[0]?.[0]).toBe("Test objective chat");
    expect(sendMessageMock.mock.calls[0]?.[2]).toBe("thread-objective_growth");
    expect(sendMessageMock.mock.calls[0]?.[3]).toBeNull();
    expect(sendMessageMock.mock.calls[0]?.[7]).toBe("alpha");
    expect(sendMessageMock.mock.calls[0]?.[8]).toEqual(
      expect.stringContaining("Objective: Get 50 visitors daily")
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Back to sessions/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to sessions/i }));

    fireEvent.click(screen.getByRole("button", { name: /How should we get there\?/i }));
    await screen.findByText("Growth Agent");
    fireEvent.click(screen.getByTestId("objective-chat-send"));

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenLastCalledWith(
        "Test objective chat",
        10,
        "thread-objective_growth",
        "user-session-1",
        undefined,
        undefined,
        ["agent-growth"],
        "alpha",
        expect.stringContaining("Objective: Get 50 visitors daily"),
        undefined
      )
    );
  });

  test("migrates legacy objective chat roots into one session thread", async () => {
    const setMessagesMock = jest.fn();
    const loadHistoryMock = jest.fn().mockResolvedValue(undefined);

    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-root",
          role: "user",
          participantId: null,
          content: "How should we get here?",
          timestamp: Date.parse("2026-04-10T04:23:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-root",
          role: "assistant",
          participantId: "agent-growth",
          content: "Start by clarifying the target surface and baseline.",
          timestamp: Date.parse("2026-04-10T04:24:00.000Z"),
          rootMessageId: "user-root",
          parentMessageId: "user-root",
          depth: 1,
        },
        {
          id: "user-follow-up",
          role: "user",
          participantId: null,
          content: "heelo",
          timestamp: Date.parse("2026-04-10T04:35:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-follow-up",
          role: "assistant",
          participantId: "agent-growth",
          content: "What's the current baseline?",
          timestamp: Date.parse("2026-04-10T04:36:00.000Z"),
          rootMessageId: "user-follow-up",
          parentMessageId: "user-follow-up",
          depth: 1,
        },
        {
          id: "user-latest",
          role: "user",
          participantId: null,
          content: "do you see all of the history?",
          timestamp: Date.parse("2026-04-10T04:39:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
        {
          id: "assistant-latest",
          role: "assistant",
          participantId: "agent-growth",
          content: "I can now see the full session thread.",
          timestamp: Date.parse("2026-04-10T04:40:00.000Z"),
          rootMessageId: "user-latest",
          parentMessageId: "user-latest",
          depth: 1,
        },
      ],
      setMessages: setMessagesMock,
      logs: [],
      sendMessage: jest.fn(),
      loadHistory: loadHistoryMock,
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });

    mockedUseProjects.mockReturnValue({
      projects: [buildProject({ chatSessionVersion: 0 })],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      createProject: jest.fn(),
      updateProject: updateProjectMock,
      deleteProject: jest.fn(),
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    await waitFor(() => expect(loadHistoryMock).toHaveBeenCalledWith("thread-objective_growth"));

    const historyRewriteCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/history" &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(historyRewriteCall).toBeDefined();

    const historyRewriteBody = JSON.parse(
      String((historyRewriteCall?.[1] as RequestInit | undefined)?.body ?? "{}")
    ) as { threadId: string; messages: Array<Record<string, unknown>> };

    expect(historyRewriteBody.threadId).toBe("thread-objective_growth");
    expect(
      historyRewriteBody.messages.filter(
        (message) => message.role === "user" && !message.rootMessageId
      )
    ).toHaveLength(1);
    expect(
      historyRewriteBody.messages.find((message) => message.id === "user-follow-up")
    ).toEqual(
      expect.objectContaining({
        rootMessageId: "user-root",
        parentMessageId: "user-root",
        depth: 1,
      })
    );
    expect(
      historyRewriteBody.messages.find((message) => message.id === "assistant-latest")
    ).toEqual(
      expect.objectContaining({
        rootMessageId: "user-root",
        parentMessageId: "user-root",
        depth: 1,
      })
    );

    expect(setMessagesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "user-follow-up",
          rootMessageId: "user-root",
          parentMessageId: "user-root",
          depth: 1,
        }),
        expect.objectContaining({
          id: "user-latest",
          rootMessageId: "user-root",
          parentMessageId: "user-root",
          depth: 1,
        }),
      ])
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/objectives/objective_growth",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ chatSessionVersion: 2 }),
      })
    );
  });

  test("interrupts the current strategy reply and sends the new message right away", async () => {
    const stopMock = jest.fn();
    const pollMock = jest.fn();
    const sendMessageMock = jest.fn().mockResolvedValue("user-session-2");

    mockedUseGroupChat.mockReturnValue({
      messages: [
        {
          id: "user-session-1",
          role: "user",
          participantId: null,
          content: "How should we get there?",
          timestamp: Date.parse("2026-04-10T04:23:00.000Z"),
          rootMessageId: null,
          parentMessageId: null,
          depth: 0,
        },
      ],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: sendMessageMock,
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [
        {
          chatRunId: "run-1",
          threadId: "thread-objective_growth",
          rootMessageId: "user-session-1",
          status: "running",
        },
      ],
      setChatRuns: jest.fn(),
      stop: stopMock,
      stopThread: jest.fn(),
    });

    mockedUseProcessPolling.mockReturnValue({
      activeAgents: [],
      processes: [],
      streaming: {},
      chatRuns: [
        {
          chatRunId: "run-1",
          threadId: "thread-objective_growth",
          rootMessageId: "user-session-1",
          status: "running",
        },
      ],
      poll: pollMock,
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/teams")) {
        return {
          ok: true,
          json: async () => teamsResponse,
        };
      }

      if (url.includes("/participants")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "agent-growth",
              name: "Growth Agent",
              provider: "claude",
              model: "sonnet",
              color: "#22c55e",
            },
          ],
        };
      }

      if (url.includes("/agents")) {
        return {
          ok: true,
          json: async () => ({
            agents: [{ agent_id: "agent-growth", routing_order: 0 }],
          }),
        };
      }

      if (url.includes("/scheduled-tasks")) {
        return {
          ok: true,
          json: async () => ({ jobs: [] }),
        };
      }

      if (url.includes("/linear-issues")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            label: "get-50-visitors-daily",
            issues: [],
          }),
        };
      }

      if (url.includes("/api/history") || url.includes("/api/logs") || url.includes("/api/chat-runs")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/api/processes")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(screen.getByTestId("objective-chat-send")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("objective-chat-send"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat-runs/run-1/signal",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            signal: "cancel",
            reason: "Interrupted by a new objective chat message",
          }),
        })
      )
    );
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(pollMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "Test objective chat",
        10,
        "thread-objective_growth",
        null,
        undefined,
        undefined,
        ["agent-growth"],
        "alpha",
        expect.stringContaining("Objective: Get 50 visitors daily"),
        undefined
      )
    );
  });

  test("restores the saved objective chat width", () => {
    window.localStorage.setItem(
      "agx:windowState",
      JSON.stringify({
        sidebar: {
          objectiveChatPanelWidth: 512,
        },
      })
    );

    const { container } = render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    const chatPanel = container.querySelector(
      '[style*="--objective-chat-panel-width: 512px"]'
    );
    expect(chatPanel).not.toBeNull();
  });

  test("uses theme tokens for the objective chat panel surfaces", () => {
    const { container } = render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    const chatPanel = container.querySelector(
      '[style*="--objective-chat-panel-width"]'
    );
    expect(chatPanel).toHaveClass("bg-[var(--overlay-panel)]");
    expect(chatPanel).not.toHaveClass("bg-[rgba(8,12,18,0.72)]");
  });

  test("creates the objective chat lazily on first send instead of on load", async () => {
    const sendMessageMock = jest.fn();
    mockedUseGroupChat.mockReturnValue({
      messages: [],
      setMessages: jest.fn(),
      logs: [],
      sendMessage: sendMessageMock,
      loadHistory: jest.fn(),
      clearHistory: jest.fn(),
      clearLogs: jest.fn(),
      chatRuns: [],
      setChatRuns: jest.fn(),
      stop: jest.fn(),
      stopThread: jest.fn(),
    });
    mockedUseProjects.mockReturnValue({
      projects: [buildProject({ objectiveThreadId: null })],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      createProject: jest.fn(),
      updateProject: updateProjectMock,
      deleteProject: jest.fn(),
    });

    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    expect(mockedThreadService.createThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("objective-chat-send"));

    await waitFor(() => expect(mockedThreadService.createThread).toHaveBeenCalledTimes(1));
    expect(mockedThreadService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "objective-chat:objective_growth",
        title: "Get 50 visitors daily",
        metadata: expect.objectContaining({
          scope: "objective",
          objectiveId: "objective_growth",
          projectId: "project-1",
          projectSlug: "alpha",
        }),
      })
    );
    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/threads",
      expect.objectContaining({ method: "POST" })
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      "Test objective chat",
      10,
      "objective-chat:objective_growth",
      null,
      undefined,
      undefined,
      [],
      "alpha",
      expect.stringContaining("Objective: Get 50 visitors daily"),
      undefined
    );
  });

  test("saves a team when creating an objective", async () => {
    render(<ProjectObjectivesOverview projectSlug="alpha" />);

    fireEvent.click(screen.getByRole("button", { name: /New objective/i }));

    const dialog = screen.getByRole("dialog", { name: /New objective/i });
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: "Product" })).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getAllByRole("textbox")[0], {
      target: { value: "Launch a partner program" },
    });
    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "team-product" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create objective/i }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledTimes(1));

    const [, payload] = updateProjectMock.mock.calls[0] as [
      string,
      { metadata: Record<string, unknown> }
    ];
    const nextWorkspace = readProjectObjectivesWorkspace(payload.metadata);
    const createdObjective = nextWorkspace.objectives.find(
      (entry) => entry.title === "Launch a partner program"
    );

    expect(createdObjective?.teamId).toBe("team-product");
  });

  test("only offers unclaimed teams when creating an objective", async () => {
    render(<ProjectObjectivesOverview projectSlug="alpha" />);

    fireEvent.click(screen.getByRole("button", { name: /New objective/i }));

    const dialog = screen.getByRole("dialog", { name: /New objective/i });
    const select = within(dialog).getByRole("combobox");
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: "Product" })).toBeInTheDocument()
    );

    expect(within(select).queryByRole("option", { name: "Growth" })).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Product" })).toBeInTheDocument();
  });

  test("opens a schedule-only editor from the wake question", () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edit cadence for Get 50 visitors daily/i })
    );

    const dialog = screen.getByRole("dialog", { name: /Edit wake schedule/i });
    expect(within(dialog).getByText("Schedule")).toBeInTheDocument();
    expect(within(dialog).getByText("Condition")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Schedule mode/i })).toBeInTheDocument();
    expect(within(dialog).queryByText("Objective statement")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Notes")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Progress \(/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Health")).not.toBeInTheDocument();
  });

  test("hides schedule details and condition controls when wake schedule is not set", () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edit cadence for Get 50 visitors daily/i })
    );

    const dialog = screen.getByRole("dialog", { name: /Edit wake schedule/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Schedule mode/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Not set$/i }));

    expect(within(dialog).queryByText("Hourly Schedule")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Condition")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Condition mode/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Set a schedule first to enable a condition.")).not.toBeInTheDocument();
  });

  test("closes the wake schedule modal on cancel", () => {
    render(
      <ProjectObjectiveDetail
        projectSlug="alpha"
        objectiveId="objective_growth"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edit cadence for Get 50 visitors daily/i })
    );

    const dialog = screen.getByRole("dialog", { name: /Edit wake schedule/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));

    expect(screen.queryByRole("dialog", { name: /Edit wake schedule/i })).not.toBeInTheDocument();
  });
});

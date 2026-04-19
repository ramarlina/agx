import { render, screen, waitFor } from "@testing-library/react";
import PromptJobBoard from "@/components/PromptJobBoard";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import { useUrlSelection } from "@/hooks/useUrlSelection";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";

jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/components/chat-ui/Markdown", () => ({ Markdown: () => null }));
jest.mock("@/hooks/usePromptJobs", () => ({
  usePromptJobs: jest.fn(),
}));
jest.mock("@/hooks/useUrlSelection", () => ({
  useUrlSelection: jest.fn(),
}));
jest.mock("@/hooks/useGroupChat", () => ({
  useGroupChat: () => ({
    messages: [],
    setMessages: jest.fn(),
    sendMessage: jest.fn(),
    loadHistory: jest.fn(() => Promise.resolve()),
    chatRuns: [],
    stop: jest.fn(),
  }),
}));
jest.mock("@/hooks/useProcessPolling", () => ({
  useProcessPolling: () => ({
    processes: [],
    streaming: false,
    chatRuns: [],
  }),
}));

const mockedUsePromptJobs = jest.mocked(usePromptJobs);
const mockedUseUrlSelection = jest.mocked(useUrlSelection);
const mockFetch = jest.fn();

global.fetch = mockFetch as typeof fetch;

function makeJob(overrides: Partial<PromptJob> = {}): PromptJob {
  return {
    id: "job-1",
    name: "Daily review",
    prompt: "Review progress",
    agentId: "agent-1",
    projectId: "project-1",
    objectiveId: null,
    objectiveKey: null,
    provider: "codex",
    model: "gpt-5.4",
    cliArgs: "",
    cronExpr: "0 9 * * *",
    cadence: "Daily at 9:00",
    state: "active",
    overlapPolicy: "skip",
    catchUpPolicy: "fire_once",
    cancelCheckSec: 30,
    executionMode: "prompt",
    scriptPrompt: "",
    teamId: "",
    builtIn: false,
    condition: "",
    nextRunAt: Date.UTC(2026, 3, 19, 16, 0, 0),
    lastRunAt: Date.UTC(2026, 3, 19, 15, 0, 0),
    prevScheduledAt: Date.UTC(2026, 3, 19, 15, 0, 0),
    lastOutcome: "success",
    createdAt: "2026-04-19T15:00:00.000Z",
    updatedAt: "2026-04-19T15:30:00.000Z",
    ...overrides,
  };
}

describe("PromptJobBoard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    });
    mockedUseUrlSelection.mockReturnValue({
      getSelection: (key: string) => (key === "job" ? "job-1" : null),
      pushSelection: jest.fn(),
      replaceSelection: jest.fn(),
    });
  });

  test("blocks delete and rerun controls when the fetched runs show live work", async () => {
    const fetchRuns = jest.fn<Promise<PromptRun[]>, [string]>().mockResolvedValue([
      {
        id: "run-1",
        jobId: "job-1",
        status: "queued",
        output: null,
        error: null,
        durationMs: null,
        startedAt: null,
        finishedAt: null,
        cancelledAt: null,
        hostPid: null,
        hostCommand: null,
        exitCode: null,
        logs: null,
        createdAt: "2026-04-19T15:45:00.000Z",
      },
    ]);

    mockedUsePromptJobs.mockReturnValue({
      jobs: [makeJob()],
      loading: false,
      error: null,
      refresh: jest.fn(),
      createJob: jest.fn(),
      updateJob: jest.fn(),
      deleteJob: jest.fn(),
      toggleJob: jest.fn(),
      runNow: jest.fn(),
      cancelRun: jest.fn(),
      fetchRuns,
    });

    render(<PromptJobBoard projectId="project-1" requireProjectId />);

    await waitFor(() => {
      expect(fetchRuns).toHaveBeenCalledWith("job-1");
    });

    await waitFor(() => {
      expect(screen.getByTitle("Run now")).toBeDisabled();
      expect(screen.getByTitle("Cancel the live run before deleting this task")).toBeDisabled();
    });

    expect(
      screen.getByText("Delete is blocked while a run is queued or running. Cancel the live run first."),
    ).toBeInTheDocument();
  });

  test("does not show overdue after a manual run when the next scheduled run is still ahead", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 3, 19, 15, 30, 0));

    mockedUsePromptJobs.mockReturnValue({
      jobs: [
        makeJob({
          nextRunAt: Date.UTC(2026, 3, 19, 23, 30, 0),
          lastRunAt: Date.UTC(2026, 3, 19, 15, 25, 0),
          prevScheduledAt: Date.UTC(2026, 3, 19, 9, 0, 0),
        }),
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      createJob: jest.fn(),
      updateJob: jest.fn(),
      deleteJob: jest.fn(),
      toggleJob: jest.fn(),
      runNow: jest.fn(),
      cancelRun: jest.fn(),
      fetchRuns: jest.fn<Promise<PromptRun[]>, [string]>().mockResolvedValue([]),
    });

    render(<PromptJobBoard projectId="project-1" requireProjectId />);

    expect(screen.queryByText(/^overdue$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Next run in 8h/i)).toBeInTheDocument();

    nowSpy.mockRestore();
  });
});

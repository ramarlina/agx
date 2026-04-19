import { act, render, screen } from "@testing-library/react";
import { ObjectiveScheduledTasksPanel } from "@/components/projects/ObjectiveScheduledTasksPanel";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";

jest.mock("@/hooks/usePromptJobs", () => ({
  usePromptJobs: jest.fn(),
}));

jest.mock("@/components/PromptJobBoard", () => ({
  CreateJobModal: () => null,
  agentAvatar: () => "",
}));

jest.mock("@/components/ConfirmDialog", () => ({
  __esModule: true,
  default: () => null,
}));

const mockedUsePromptJobs = jest.mocked(usePromptJobs);
const mockFetch = jest.fn();

global.fetch = mockFetch as typeof fetch;

function makeJob(overrides: Partial<PromptJob> = {}): PromptJob {
  return {
    id: "job-1",
    name: "Daily review",
    prompt: "Review progress",
    agentId: "agent-1",
    projectId: "project-1",
    objectiveId: "objective-1",
    objectiveKey: "objective_alpha",
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
    nextRunAt: Date.UTC(2026, 3, 18, 23, 30, 0),
    lastRunAt: Date.UTC(2026, 3, 18, 15, 25, 0),
    prevScheduledAt: Date.UTC(2026, 3, 18, 9, 0, 0),
    lastOutcome: "success",
    createdAt: "2026-04-18T15:00:00.000Z",
    updatedAt: "2026-04-18T15:30:00.000Z",
    ...overrides,
  };
}

describe("ObjectiveScheduledTasksPanel overdue status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    });
    mockedUsePromptJobs.mockReturnValue({
      jobs: [makeJob()],
      loading: false,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
      createJob: jest.fn(),
      updateJob: jest.fn().mockResolvedValue(true),
      deleteJob: jest.fn().mockResolvedValue({ ok: true }),
      toggleJob: jest.fn().mockResolvedValue(true),
      runNow: jest.fn().mockResolvedValue(true),
      cancelRun: jest.fn(),
      fetchRuns: jest.fn<Promise<PromptRun[]>, [string]>().mockResolvedValue([]),
    });
  });

  test("keeps a fresh manual run healthy while the next scheduled run is still ahead", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 3, 18, 15, 30, 0));

    await act(async () => {
      render(
        <ObjectiveScheduledTasksPanel
          projectId="project-1"
          objectiveId="objective-1"
          objectiveKey="objective_alpha"
          onCreateTask={jest.fn().mockResolvedValue(true)}
        />
      );
    });

    expect(screen.queryByText(/^overdue$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Next run in 8h/i)).toBeInTheDocument();

    nowSpy.mockRestore();
  });
});

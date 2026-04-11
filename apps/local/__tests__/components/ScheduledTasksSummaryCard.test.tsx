import { render, screen, waitFor } from "@testing-library/react";
import { ScheduledTasksSummaryCard } from "@/components/projects/ScheduledTasksSummaryCard";
import type { AutomationItem } from "@/app/api/automations/route";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";

describe("ScheduledTasksSummaryCard", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 3, 10, 10, 55, 0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test("shows currently running tasks and upcoming runs", async () => {
    const automations: AutomationItem[] = [
      {
        taskId: "task-1",
        graphId: "graph-1",
        title: "Automation sweep",
        projectId: "project-1",
        executionState: "running",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-10T10:00:00.000Z",
        schedule: {
          intervalMs: 3600000,
          state: "active",
          resetNodeIds: [],
          runCount: 1,
          tickInProgress: true,
          createdAt: "2026-04-09T10:00:00.000Z",
          nextTickAt: Date.UTC(2026, 3, 10, 18, 0, 0),
        },
      },
      {
        taskId: "task-2",
        graphId: "graph-2",
        title: "Evening digest",
        projectId: "project-1",
        executionState: "ready",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-10T09:00:00.000Z",
        schedule: {
          intervalMs: 3600000,
          state: "active",
          resetNodeIds: [],
          runCount: 1,
          tickInProgress: false,
          createdAt: "2026-04-09T10:00:00.000Z",
          nextTickAt: Date.UTC(2026, 3, 10, 12, 0, 0),
        },
      },
      {
        taskId: "task-3",
        graphId: "graph-3",
        title: "Paused cleanup",
        projectId: "project-1",
        executionState: "paused",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-10T08:00:00.000Z",
        schedule: {
          intervalMs: 3600000,
          state: "paused",
          resetNodeIds: [],
          runCount: 1,
          tickInProgress: false,
          createdAt: "2026-04-09T10:00:00.000Z",
        },
      },
    ];

    const jobs: PromptJob[] = [
      {
        id: "job-1",
        name: "Morning sync",
        prompt: "Run the sync",
        agentId: "agent-1",
        projectId: "project-1",
        provider: "codex",
        model: "gpt-5.4",
        cliArgs: "",
        cronExpr: "0 * * * *",
        cadence: "Every 1 hour",
        state: "active",
        overlapPolicy: "skip",
        catchUpPolicy: "fire_once",
        cancelCheckSec: 30,
        condition: "",
        nextRunAt: Date.UTC(2026, 3, 10, 11, 0, 0),
        lastRunAt: Date.UTC(2026, 3, 10, 10, 0, 0),
        lastOutcome: "success",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-10T10:00:00.000Z",
      },
      {
        id: "job-2",
        name: "Backlog review",
        prompt: "Review backlog",
        agentId: "agent-1",
        projectId: "project-1",
        provider: "codex",
        model: "gpt-5.4",
        cliArgs: "",
        cronExpr: "30 * * * *",
        cadence: "Every 1 hour at :30",
        state: "active",
        overlapPolicy: "skip",
        catchUpPolicy: "fire_once",
        cancelCheckSec: 30,
        condition: "",
        nextRunAt: Date.UTC(2026, 3, 10, 11, 30, 0),
        lastRunAt: Date.UTC(2026, 3, 10, 10, 30, 0),
        lastOutcome: "success",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-10T09:30:00.000Z",
      },
    ];

    const runsByJobId: Record<string, PromptRun[]> = {
      "job-1": [
        {
          id: "run-1",
          jobId: "job-1",
          status: "running",
          output: null,
          error: null,
          durationMs: null,
          startedAt: "2026-04-10T10:55:00.000Z",
          finishedAt: null,
          cancelledAt: null,
          hostPid: null,
          hostCommand: null,
          createdAt: "2026-04-10T10:55:00.000Z",
        },
      ],
      "job-2": [],
    };

    jest.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/automations") {
        return {
          ok: true,
          json: async () => ({ automations }),
        } as Response;
      }
      if (url === "/api/prompt-jobs?projectId=project-1") {
        return {
          ok: true,
          json: async () => ({ jobs }),
        } as Response;
      }
      if (url === "/api/prompt-jobs/job-1/runs") {
        return {
          ok: true,
          json: async () => ({ runs: runsByJobId["job-1"] }),
        } as Response;
      }
      if (url === "/api/prompt-jobs/job-2/runs") {
        return {
          ok: true,
          json: async () => ({ runs: runsByJobId["job-2"] }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ScheduledTasksSummaryCard projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByText("Morning sync")).toBeInTheDocument();
    });

    expect(screen.getByText("Currently running")).toBeInTheDocument();
    expect(screen.getByText("Upcoming runs")).toBeInTheDocument();
    expect(screen.getAllByText("running")).toHaveLength(2);
    expect(screen.getByText("Automation sweep")).toBeInTheDocument();
    expect(screen.getByText("Evening digest")).toBeInTheDocument();
    expect(screen.getByText("Backlog review")).toBeInTheDocument();
    expect(screen.getByText(/in 35m/)).toBeInTheDocument();
    expect(screen.getByText(/in 1h 5m/)).toBeInTheDocument();
    expect(screen.queryByText("Paused cleanup")).not.toBeInTheDocument();
    expect(screen.queryByText("No scheduled tasks")).not.toBeInTheDocument();
  });
});

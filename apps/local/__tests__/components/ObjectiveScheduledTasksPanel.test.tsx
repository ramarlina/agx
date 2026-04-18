import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ObjectiveScheduledTasksPanel } from "@/components/projects/ObjectiveScheduledTasksPanel";
import { usePromptJobs } from "@/hooks/usePromptJobs";
import type { PromptJob, PromptRun } from "@/src/prompt-scheduler/types";

jest.mock("@/hooks/usePromptJobs", () => ({
  usePromptJobs: jest.fn(),
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

jest.mock("@/components/PromptJobBoard", () => ({
  CreateJobModal: () => null,
}));

jest.mock("@/components/ConfirmDialog", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/scheduling/ScheduleConditionPicker", () => ({
  ScheduleConditionPicker: () => null,
}));

const mockedUsePromptJobs = jest.mocked(usePromptJobs);

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
    nextRunAt: Date.UTC(2026, 3, 18, 16, 0, 0),
    lastRunAt: Date.UTC(2026, 3, 18, 15, 0, 0),
    prevScheduledAt: Date.UTC(2026, 3, 18, 15, 0, 0),
    lastOutcome: "success",
    createdAt: "2026-04-18T15:00:00.000Z",
    updatedAt: "2026-04-18T15:30:00.000Z",
    ...overrides,
  };
}

describe("ObjectiveScheduledTasksPanel", () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const deleteJob = jest.fn().mockResolvedValue(true);
  const toggleJob = jest.fn().mockResolvedValue(true);
  const updateJob = jest.fn().mockResolvedValue(true);
  const fetchRuns = jest.fn<Promise<PromptRun[]>, [string]>().mockResolvedValue([]);
  const runNow = jest.fn().mockResolvedValue(true);
  const onCreateTask = jest.fn().mockResolvedValue(true);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUsePromptJobs.mockReturnValue({
      jobs: [
        makeJob(),
        makeJob({
          id: "job-2",
          name: "Weekly digest",
          prompt: "Summarize the week",
          cronExpr: "0 12 * * 1",
          cadence: "Weekly on Monday at 12:00",
        }),
      ],
      loading: false,
      error: null,
      refresh,
      createJob: jest.fn(),
      updateJob,
      deleteJob,
      toggleJob,
      runNow,
      cancelRun: jest.fn(),
      fetchRuns,
    });
  });

  test("keeps the selected job open after saving prompt edits", async () => {
    render(
      <ObjectiveScheduledTasksPanel
        projectId="project-1"
        objectiveId="objective-1"
        objectiveKey="objective_alpha"
        onCreateTask={onCreateTask}
      />
    );

    fireEvent.click(screen.getByText("Daily review"));

    const editor = screen.getByLabelText("Write instructions in markdown…");
    fireEvent.change(editor, { target: { value: "Review progress and blockers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateJob).toHaveBeenCalledWith("job-1", {
        prompt: "Review progress and blockers",
      });
    });

    expect(screen.getByDisplayValue("Review progress and blockers")).toBeInTheDocument();
    expect(screen.getByLabelText("Write instructions in markdown…")).toBeInTheDocument();
  });

  test("selects the job that is manually run", async () => {
    render(
      <ObjectiveScheduledTasksPanel
        projectId="project-1"
        objectiveId="objective-1"
        objectiveKey="objective_alpha"
        onCreateTask={onCreateTask}
      />
    );

    const runButtons = screen.getAllByTitle("Run now");
    fireEvent.click(runButtons[1]!);

    await waitFor(() => {
      expect(runNow).toHaveBeenCalledWith("job-2");
    });

    expect(screen.getByDisplayValue("Summarize the week")).toBeInTheDocument();
    expect(screen.getByLabelText("Write instructions in markdown…")).toBeInTheDocument();
  });
});

/**
 * @jest-environment jsdom
 */

import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";

const mockUseTasks = jest.fn();
const mockUseTaskComments = jest.fn();
const mockUseLearnings = jest.fn();
const mockUseProjects = jest.fn();
const mockUseWorkflows = jest.fn();
const mockUseProviders = jest.fn();

jest.mock("@/hooks/useTasks", () => ({
  useTasks: () => mockUseTasks(),
  useTaskComments: () => mockUseTaskComments(),
  useLearnings: () => mockUseLearnings(),
}));

jest.mock("@/hooks/useProjects", () => ({
  useProjects: () => mockUseProjects(),
}));

jest.mock("@/hooks/useWorkflows", () => ({
  DEFAULT_WORKFLOW_ID: "default",
  useWorkflows: () => mockUseWorkflows(),
}));

jest.mock("@/hooks/useProviders", () => ({
  useProviders: () => mockUseProviders(),
}));

jest.mock("@/components/ProtectedLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/TaskList", () => ({
  __esModule: true,
  default: () => <div data-testid="task-list" />,
}));

jest.mock("@/components/KanbanBoard", () => ({
  __esModule: true,
  default: () => <div data-testid="kanban-board" />,
}));

jest.mock("@/components/TaskDetail", () => ({
  __esModule: true,
  default: () => <div data-testid="task-detail" />,
}));

jest.mock("@/components/StageSettingsModal", () => ({
  __esModule: true,
  default: () => <div data-testid="stage-settings" />,
}));

const baseTask = {
  id: "task-1",
  content: "Test task content",
  title: "Test Task",
  status: "in_progress",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const noop = () => Promise.resolve();

const buildUseTasksReturn = ({
  cancelWorkflow,
  refetch,
}: {
  cancelWorkflow: jest.MockedFunction<() => Promise<unknown>>;
  refetch: jest.MockedFunction<() => Promise<unknown>>;
}) => ({
  tasks: [baseTask],
  isLoading: false,
  error: null,
  cancellingTaskId: null,
  isCancelling: false,
  cancelError: null,
  createTask: jest.fn(noop),
  updateTask: jest.fn(noop),
  deleteTask: jest.fn(noop),
  completeTaskStage: jest.fn(noop),
  cancelWorkflow,
  refetch,
  fetchTask: jest.fn(() => Promise.resolve(baseTask)),
});

const baseTaskComments = {
  comments: [],
  isLoading: false,
  refetch: jest.fn(),
  addComment: jest.fn(),
  deleteComment: jest.fn(),
};

const baseLearnings = {
  learnings: { task: [], project: [], global: [] },
  addLearning: jest.fn(),
};

const baseProjects = { projects: [], isLoading: false };

const baseWorkflows = {
  workflow: null,
  stages: [],
  stageConfig: {},
  isValidTransition: jest.fn(() => true),
  isLoading: false,
};

const baseProviders = { providers: [] };

describe("Dashboard stop flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTaskComments.mockReturnValue(baseTaskComments);
    mockUseLearnings.mockReturnValue(baseLearnings);
    mockUseProjects.mockReturnValue(baseProjects);
    mockUseWorkflows.mockReturnValue(baseWorkflows);
    mockUseProviders.mockReturnValue(baseProviders);
  });

  test("stop button signals cancellation and shows toast", async () => {
    const cancelWorkflow = jest.fn().mockResolvedValue({});
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockUseTasks.mockReturnValue(buildUseTasksReturn({ cancelWorkflow, refetch }));

    render(<DashboardPage />);

    const stopButton = await screen.findByRole("button", { name: "Stop Task" });
    fireEvent.click(stopButton);

    await waitFor(() => expect(cancelWorkflow).toHaveBeenCalledWith({ taskId: "task-1" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());

    expect(await screen.findByText(/Cancellation requested for Test Task/)).toBeInTheDocument();
  });

  test("cancellation error surfaces toast and skips refetch", async () => {
    const cancelWorkflow = jest.fn().mockRejectedValue(new Error("Failed to cancel"));
    const refetch = jest.fn();
    mockUseTasks.mockReturnValue(buildUseTasksReturn({ cancelWorkflow, refetch }));

    render(<DashboardPage />);

    const stopButton = await screen.findByRole("button", { name: "Stop Task" });
    fireEvent.click(stopButton);

    await waitFor(() => expect(cancelWorkflow).toHaveBeenCalled());
    expect(refetch).not.toHaveBeenCalled();

    expect(await screen.findByText(/Unable to stop Test Task: Failed to cancel\./)).toBeInTheDocument();
  });
});

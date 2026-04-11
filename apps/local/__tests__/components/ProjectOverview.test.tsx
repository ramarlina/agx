import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectOverview } from "@/components/projects/ProjectOverview";
import {
  createProjectObjective,
  readProjectObjectivesWorkspace,
  upsertProjectObjective,
  writeProjectObjectivesWorkspace,
} from "@/lib/project-objectives";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

jest.mock("@/components/projects/TeamsSummaryCard", () => ({
  TeamsSummaryCard: () => <div data-testid="teams-summary-card" />,
}));

jest.mock("@/components/projects/ObjectivesSummaryCard", () => ({
  ObjectivesSummaryCard: () => <div data-testid="objectives-summary-card" />,
}));

jest.mock("@/components/projects/ScheduledTasksSummaryCard", () => ({
  ScheduledTasksSummaryCard: () => <div data-testid="scheduled-tasks-summary-card" />,
}));

jest.mock("@/components/projects/FoldersSummaryCard", () => ({
  FoldersSummaryCard: () => <div data-testid="folders-summary-card" />,
}));

jest.mock("@/components/projects/RecentThreadsSummaryCard", () => ({
  RecentThreadsSummaryCard: ({
    onSelectThread,
  }: {
    onSelectThread?: (thread: {
      id: string;
      threadId: string;
      title: string;
      status: string;
      lastActivity: number;
    }) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSelectThread?.({
            id: "root-objective",
            threadId: "objective-chat:objective_growth",
            title: "How should we get there?",
            status: "active",
            lastActivity: 100,
          })
        }
      >
        Open objective thread
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectThread?.({
            id: "root-general",
            threadId: "thread-general",
            title: "General project thread",
            status: "active",
            lastActivity: 50,
          })
        }
      >
        Open general thread
      </button>
    </div>
  ),
}));

function buildProjectMetadata() {
  const workspace = upsertProjectObjective(
    readProjectObjectivesWorkspace(undefined),
    createProjectObjective({
      id: "objective_growth",
      title: "Grow activation",
      teamId: "team-growth",
      threadId: "objective-chat:objective_growth",
      now: "2026-04-10T12:00:00.000Z",
    })
  );

  return writeProjectObjectivesWorkspace({}, workspace);
}

describe("ProjectOverview", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  test("routes recent objective threads to the objective detail view", () => {
    render(
      <ProjectOverview
        projectId="project-1"
        projectSlug="alpha"
        projectName="Alpha"
        projectMetadata={buildProjectMetadata()}
        repos={[]}
        threadIds={["thread-general"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open objective thread" }));

    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/objectives/objective_growth");
  });

  test("keeps non-objective recent threads on the project chat route", () => {
    render(
      <ProjectOverview
        projectId="project-1"
        projectSlug="alpha"
        projectName="Alpha"
        projectMetadata={buildProjectMetadata()}
        repos={[]}
        threadIds={["thread-general"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open general thread" }));

    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/thread/thread-general?open=root-general");
  });
});

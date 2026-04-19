import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectHome } from "@/components/projects/ProjectHome";
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

jest.mock("@/components/projects/WorkingNowCard", () => ({
  WorkingNowCard: () => <div data-testid="working-now-card" />,
}));

jest.mock("@/components/projects/RecentlyCompletedCard", () => ({
  RecentlyCompletedCard: ({
    projectSlug,
  }: {
    projectSlug: string;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => pushMock(`/projects/${projectSlug}/objectives/objective_growth`)}
      >
        Open objective thread
      </button>
      <button
        type="button"
        onClick={() => pushMock(`/projects/${projectSlug}/thread/thread-general?open=root-general`)}
      >
        Open general thread
      </button>
    </div>
  ),
}));

jest.mock("@/components/projects/home/ObjectivesSection", () => ({
  ObjectivesSection: () => <div data-testid="objectives-section" />,
}));

jest.mock("@/components/projects/home/ToolPathsSection", () => ({
  ToolPathsSection: () => <div data-testid="tool-paths-section" />,
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

describe("ProjectHome", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  test("routes recent objective threads to the objective detail view", () => {
    render(
      <ProjectHome
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
      <ProjectHome
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

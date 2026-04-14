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

jest.mock("@/components/projects/WorkingNowCard", () => ({
  WorkingNowCard: () => <div data-testid="working-now-card" />,
}));

jest.mock("@/components/projects/home/ObjectivesSection", () => ({
  ObjectivesSection: () => <div data-testid="objectives-section" />,
}));

jest.mock("@/components/projects/home/ToolPathsSection", () => ({
  ToolPathsSection: () => <div data-testid="tool-paths-section" />,
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

  test("explains the project mental model and points new users to the next steps", () => {
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

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText("Alpha is your project home base")).toBeInTheDocument();
    expect(screen.getByText("How AGX is organized")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /1\. Add folders/i }));
    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/folders");
  });

  test("routes the start-here objective action to the project objectives view", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /2\. Define an objective/i }));

    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/objectives");
  });

  test("routes the start-here chat action to the primary project thread", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /3\. Start in chat/i }));

    expect(pushMock).toHaveBeenCalledWith("/projects/alpha/thread/thread-general");
  });
});

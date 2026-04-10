import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectWithRepos } from "@/hooks/useProjects";
import { useProjects } from "@/hooks/useProjects";
import {
  ProjectObjectiveDetail,
  ProjectObjectivesOverview,
} from "@/components/projects/ProjectObjectivesWorkspace";
import {
  addObjectiveActivity,
  appendObjectiveActivityThreadMessage,
  createManualObjectiveActivity,
  createObjectiveActivityThreadMessage,
  createObjectiveManualTask,
  createProjectObjective,
  readProjectObjectivesWorkspace,
  removeProjectObjective,
  upsertObjectiveManualTask,
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

const mockedUseProjects = jest.mocked(useProjects);
const updateProjectMock = jest.fn();
const confirmMock = jest.fn();
const fetchMock = jest.fn();

const teamsResponse = {
  teams: [
    { id: "team-growth", name: "Growth" },
    { id: "team-product", name: "Product" },
  ],
};

function buildProject(): ProjectWithRepos {
  const objective = createProjectObjective({
    id: "objective_growth",
    title: "Get 50 visitors daily",
    teamId: "team-growth",
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
  workspace = upsertObjectiveManualTask(
    workspace,
    objective.id,
    createObjectiveManualTask({
      id: "task_refresh_cta",
      title: "Refresh referral CTA",
      notes: "Review landing page copy",
      status: "in_progress",
      now: "2026-04-09T12:15:00.000Z",
    }),
    "2026-04-09T12:15:00.000Z"
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
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => teamsResponse,
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

    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText(/1 activity · Last Apr 9,/i)).toBeInTheDocument();
    expect(screen.queryByText("Focus on referral traffic first.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open details for Get 50 visitors daily/i })
    ).toHaveAttribute("href", "/projects/alpha/objectives/objective_growth");
    fireEvent.click(screen.getByRole("button", { name: /Get 50 visitors daily/i }));
    expect(screen.getByText("Focus on referral traffic first.")).toBeInTheDocument();
    expect(screen.queryByText("Activity timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual tasks")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete objective/i })).not.toBeInTheDocument();
  });

  test("keeps objective creation minimal", () => {
    render(<ProjectObjectivesOverview projectSlug="alpha" />);

    fireEvent.click(screen.getByRole("button", { name: /New objective/i }));

    const dialog = screen.getByRole("dialog", { name: /New objective/i });

    expect(within(dialog).getByText("Objective statement")).toBeInTheDocument();
    expect(within(dialog).getByText("Team owner")).toBeInTheDocument();
    expect(within(dialog).getByText("Notes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Cadence")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Health")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Progress \(/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Create objective/i })).toBeInTheDocument();
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
    expect(screen.getByText("Team owner")).toBeInTheDocument();
    await screen.findByText("Growth");
    expect(screen.getByText("Every weekday morning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Edit cadence for Get 50 visitors daily/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Condition")).not.toBeInTheDocument();
    expect(screen.getByText("Scheduled Tasks")).toBeInTheDocument();
    expect(screen.getByText("Linear Tickets")).toBeInTheDocument();
    expect(screen.getByText("Review landing page copy")).toBeInTheDocument();
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Cadence")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Referral CTA refreshed")).not.toBeInTheDocument();
    expect(
      screen.getByText("No Linear ticket tracking configured for this objective yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete objective Get 50 visitors daily/i })
    ).toBeInTheDocument();
  });

  test("saves a team owner when creating an objective", async () => {
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

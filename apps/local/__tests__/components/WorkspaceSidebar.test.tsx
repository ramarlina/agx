import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import type { Thread } from "@/lib/storage";
import type { ProjectWithAgents } from "@/hooks/useProjects";
import type { SidebarStageResult } from "@/hooks/useSidebarStage";
import {
  createProjectObjective,
  readProjectObjectivesWorkspace,
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

function stageShow(stage: 1 | 2 | 3 | 4): SidebarStageResult["show"] {
  return {
    home: true,
    threads: true,
    terminal: true,
    objectives: stage >= 2,
    objectivesIsNew: stage === 2,
    linear: stage >= 3,
    teams: stage >= 3,
    folders: stage >= 3,
    scheduledTasks: true,
    envVars: stage >= 4,
  };
}

const baseProject: ProjectWithAgents = {
  id: "project-1",
  name: "Alpha",
  slug: "alpha",
  description: "",
  metadata: {},
  created_at: "2026-03-08T00:00:00.000Z",
  updated_at: "2026-03-08T00:00:00.000Z",
  repos: [],
  agents: [],
  thread_ids: ["server-thread-1"],
  workspace_ids: ["server-thread-1"],
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof WorkspaceSidebar>> = {}) {
  return render(
    <WorkspaceSidebar
      threads={[] as Thread[]}
      participants={[]}
      activeThreadId={null}
      isLoading={false}
      isCreating={false}
      onSelectThread={jest.fn()}
      onCreateThread={jest.fn()}
      onRenameThread={jest.fn()}
      onDeleteThread={jest.fn()}
      visible
      projects={[baseProject]}
      activeProjectId={baseProject.id}
      activeProjectView="home"
      stageShow={stageShow(4)}
      {...overrides}
    />
  );
}

describe("WorkspaceSidebar", () => {
  test("renders objectives project links, but not knowledge", () => {
    renderSidebar({ activeProjectView: "objectives", stageShow: stageShow(2) });

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/projects/alpha");
    expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Knowledge" })).not.toBeInTheDocument();
  });

  test("navigates to a project's linked thread even when local thread metadata is missing", () => {
    const onSelectThread = jest.fn();

    renderSidebar({
      onSelectThread,
      activeProjectView: "objectives",
      stageShow: stageShow(2),
    });

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(onSelectThread).toHaveBeenCalledWith("server-thread-1");
  });

  test("prefers the project's thread_ids order over alphabetically sorted local threads", () => {
    const onSelectThread = jest.fn();
    const project: ProjectWithAgents = {
      ...baseProject,
      thread_ids: ["z-thread", "a-thread"],
      workspace_ids: ["z-thread", "a-thread"],
    };
    const threads: Thread[] = [
      { id: "a-thread", title: "A thread", messages: [], createdAt: 1, updatedAt: 1 },
      { id: "z-thread", title: "Z thread", messages: [], createdAt: 2, updatedAt: 2 },
    ];

    renderSidebar({
      threads,
      onSelectThread,
      projects: [project],
      activeProjectView: "objectives",
      stageShow: stageShow(2),
    });

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(onSelectThread).toHaveBeenCalledWith("z-thread");
  });

  test("does not expose a create-chat fallback when a project has no linked thread", () => {
    const project: ProjectWithAgents = {
      ...baseProject,
      thread_ids: [],
      workspace_ids: [],
    };

    renderSidebar({
      projects: [project],
      activeProjectView: "objectives",
      stageShow: stageShow(2),
    });

    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument();
  });

  test("hides unassigned threads and deletes legacy duplicate objective chats", async () => {
    const now = "2026-04-10T00:00:00.000Z";
    const workspace = upsertProjectObjective(
      readProjectObjectivesWorkspace(undefined),
      createProjectObjective({
        id: "objective_growth",
        title: "Get 100 visitors daily",
        teamId: "team-growth",
        now,
      })
    );
    const project: ProjectWithAgents = {
      ...baseProject,
      metadata: writeProjectObjectivesWorkspace({}, workspace),
      created_at: now,
      updated_at: now,
      thread_ids: ["objective-chat:objective_growth"],
      workspace_ids: ["objective-chat:objective_growth"],
    };
    const onDeleteThread = jest.fn();
    const threads: Thread[] = [
      {
        id: "objective-chat:objective_growth",
        title: "Get 100 visitors daily",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        metadata: { scope: "objective", objectiveId: "objective_growth" },
      },
      {
        id: "legacy-dup",
        title: "Get 100 visitors daily",
        messages: [],
        createdAt: 2,
        updatedAt: 2,
        metadata: { scope: "objective", objectiveId: "objective_growth" },
      },
    ];

    renderSidebar({
      threads,
      onDeleteThread,
      projects: [project],
      activeProjectView: "objectives",
      stageShow: stageShow(2),
    });

    expect(screen.queryByText("Unassigned Threads")).not.toBeInTheDocument();
    await waitFor(() => expect(onDeleteThread).toHaveBeenCalledWith("legacy-dup"));
  });

  describe("progressive stage gating", () => {
    test("stage 1 shows only Home, Chat, and Terminal", () => {
      renderSidebar({ stageShow: stageShow(1) });

      expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Terminal" })).toBeInTheDocument();

      expect(screen.queryByRole("link", { name: "Objectives" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Teams" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Folders" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Env Vars" })).not.toBeInTheDocument();
    });

    test("stage 2 adds Objectives with NEW badge", () => {
      renderSidebar({ stageShow: stageShow(2) });

      expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
      expect(screen.getByText("NEW")).toBeInTheDocument();

      expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
    });

    test("stage 3 adds Tasks and Teams, no NEW badge on Objectives", () => {
      renderSidebar({ stageShow: stageShow(3) });

      expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
      expect(screen.queryByText("NEW")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Teams" })).toBeInTheDocument();

      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Env Vars" })).not.toBeInTheDocument();
    });

    test("stage 4 shows full sidebar including Scheduled Jobs and Env Vars", () => {
      renderSidebar({ stageShow: stageShow(4) });

      expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Teams" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Env Vars" })).toBeInTheDocument();
    });

    test("collapsed rail matches expanded sidebar for each stage", () => {
      const { unmount: u1 } = renderSidebar({ visible: false, stageShow: stageShow(1) });
      expect(screen.queryByRole("link", { name: "Objectives" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
      u1();

      const { unmount: u3 } = renderSidebar({ visible: false, stageShow: stageShow(3) });
      expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
      u3();

      renderSidebar({ visible: false, stageShow: stageShow(4) });
      expect(screen.getByRole("link", { name: "Scheduled Jobs" })).toBeInTheDocument();
    });
  });
});

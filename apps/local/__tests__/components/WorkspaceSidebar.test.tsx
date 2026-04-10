import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import type { Thread } from "@/lib/storage";
import type { ProjectWithAgents } from "@/hooks/useProjects";

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

describe("WorkspaceSidebar", () => {
  test("renders objectives project links, but not knowledge", () => {
    const project: ProjectWithAgents = {
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

    render(
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
        projects={[project]}
        activeProjectId={project.id}
        activeProjectView="objectives"
      />
    );

    expect(screen.getByRole("link", { name: "Objectives" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Knowledge" })).not.toBeInTheDocument();
  });

  test("navigates to a project's linked thread even when local thread metadata is missing", () => {
    const onSelectThread = jest.fn();
    const project: ProjectWithAgents = {
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

    render(
      <WorkspaceSidebar
        threads={[] as Thread[]}
        participants={[]}
        activeThreadId={null}
        isLoading={false}
        isCreating={false}
        onSelectThread={onSelectThread}
        onCreateThread={jest.fn()}
        onRenameThread={jest.fn()}
        onDeleteThread={jest.fn()}
        visible
        projects={[project]}
        activeProjectId={project.id}
        activeProjectView="objectives"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(onSelectThread).toHaveBeenCalledWith("server-thread-1");
  });

  test("prefers the project's thread_ids order over alphabetically sorted local threads", () => {
    const onSelectThread = jest.fn();
    const project: ProjectWithAgents = {
      id: "project-1",
      name: "Alpha",
      slug: "alpha",
      description: "",
      metadata: {},
      created_at: "2026-03-08T00:00:00.000Z",
      updated_at: "2026-03-08T00:00:00.000Z",
      repos: [],
      agents: [],
      thread_ids: ["z-thread", "a-thread"],
      workspace_ids: ["z-thread", "a-thread"],
    };
    const threads: Thread[] = [
      {
        id: "a-thread",
        title: "A thread",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "z-thread",
        title: "Z thread",
        messages: [],
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    render(
      <WorkspaceSidebar
        threads={threads}
        participants={[]}
        activeThreadId={null}
        isLoading={false}
        isCreating={false}
        onSelectThread={onSelectThread}
        onCreateThread={jest.fn()}
        onRenameThread={jest.fn()}
        onDeleteThread={jest.fn()}
        visible
        projects={[project]}
        activeProjectId={project.id}
        activeProjectView="objectives"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(onSelectThread).toHaveBeenCalledWith("z-thread");
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecentThreadsSummaryCard } from "@/components/projects/RecentThreadsSummaryCard";

describe("RecentThreadsSummaryCard", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("shows the last 5 root discussions ordered by last activity with title and status", async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 6,
        threads: {
          "workspace-1": {
            name: "Agx",
            threads: [
              {
                id: "root-1",
                threadId: "workspace-1",
                title: "Old discussion",
                status: "paused",
                replyCount: 2,
                createdAt: 100,
                lastActivity: 100,
                outcomeNote: null,
              },
              {
                id: "root-2",
                threadId: "workspace-1",
                title: "Newest discussion",
                status: "active",
                replyCount: 5,
                createdAt: 200,
                lastActivity: 600,
                outcomeNote: null,
              },
            ],
          },
          "workspace-2": {
            name: "Agx",
            threads: [
              {
                id: "root-3",
                threadId: "workspace-2",
                title: "Review discussion",
                status: "in-review",
                replyCount: 1,
                createdAt: 300,
                lastActivity: 500,
                outcomeNote: null,
              },
              {
                id: "root-4",
                threadId: "workspace-2",
                title: "Done discussion",
                status: "done",
                replyCount: 3,
                createdAt: 400,
                lastActivity: 400,
                outcomeNote: null,
              },
              {
                id: "root-5",
                threadId: "workspace-2",
                title: "Second oldest",
                status: "active",
                replyCount: 0,
                createdAt: 500,
                lastActivity: 200,
                outcomeNote: null,
              },
              {
                id: "root-6",
                threadId: "workspace-2",
                title: "Middle discussion",
                status: "paused",
                replyCount: 0,
                createdAt: 600,
                lastActivity: 300,
                outcomeNote: null,
              },
            ],
          },
        },
      }),
    } as Response);

    const onSelectThread = jest.fn();

    render(<RecentThreadsSummaryCard projectId="project-1" onSelectThread={onSelectThread} />);

    await waitFor(() => {
      expect(screen.getByText("Newest discussion")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/threads?projectId=project-1&limit=5&format=json");
    expect(screen.getByText("6")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Newest discussion"),
      expect.stringContaining("Review discussion"),
      expect.stringContaining("Done discussion"),
      expect.stringContaining("Middle discussion"),
      expect.stringContaining("Second oldest"),
    ]);

    expect(screen.getAllByText("active")).toHaveLength(2);
    expect(screen.getByText("in review")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.queryByText("Old discussion")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Newest discussion/i }));
    expect(onSelectThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "root-2",
        threadId: "workspace-1",
        title: "Newest discussion",
        status: "active",
      })
    );
  });

  test("calls onViewAll when the view all button is pressed", async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 1,
        threads: {
          "workspace-1": {
            name: "Agx",
            threads: [
              {
                id: "root-1",
                threadId: "workspace-1",
                title: "Newest discussion",
                status: "active",
                replyCount: 0,
                createdAt: 200,
                lastActivity: 600,
                outcomeNote: null,
              },
            ],
          },
        },
      }),
    } as Response);

    const onViewAll = jest.fn();
    render(<RecentThreadsSummaryCard projectId="project-1" onViewAll={onViewAll} />);

    await waitFor(() => {
      expect(screen.getByText("Newest discussion")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /View all/i }));
    expect(onViewAll).toHaveBeenCalled();
  });
});

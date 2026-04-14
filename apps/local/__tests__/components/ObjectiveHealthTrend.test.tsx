import { render, screen, waitFor } from "@testing-library/react";
import { ObjectiveHealthTrend } from "@/components/projects/ObjectiveHealthTrend";

describe("ObjectiveHealthTrend", () => {
  beforeEach(() => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          activities: [
            {
              id: "activity-1",
              source: "scheduled-task:e84da7c8",
              objectiveLabel: "get-100-visitors-daily",
              createdAt: "2026-04-14T03:00:21.579Z",
              type: "status-update",
              body: "**Objective worker** — success\n\nObjective health: 5% On track",
            },
            {
              id: "activity-2",
              source: "scheduled-task:e84da7c8",
              objectiveLabel: "get-100-visitors-daily",
              createdAt: "2026-04-14T03:00:21.580Z",
              type: "status-update",
              body: "**Objective worker** — success\n\nObjective health: 5% On track",
            },
            {
              id: "activity-3",
              source: "scheduled-task:e84da7c8",
              objectiveLabel: "get-100-visitors-daily",
              createdAt: "2026-04-14T06:35:13.400Z",
              type: "status-update",
              body: "**Objective worker** — success\n\nObjective health: 15% On track",
            },
          ],
          total: 3,
          page: 1,
          limit: 100,
          hasMore: false,
        }),
      }),
    });
  });

  test("renders a compact objective health trend and dedupes duplicate samples", async () => {
    render(
      <ObjectiveHealthTrend
        projectId="project-1"
        objectiveId="objective-1"
        objectiveKey="get-100-visitors-daily"
        metadata={undefined}
        currentProgress={15}
        currentStatus="on_track"
        objectiveUpdatedAt="2026-04-14T06:35:13.400Z"
      />,
    );

    expect(screen.getByTestId("objective-health-trend")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("2 updates")).toBeInTheDocument();
    });

    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByLabelText("Objective health trend")).toBeInTheDocument();
  });
});

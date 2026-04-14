import {
  appendObjectiveHealthSample,
  buildObjectiveHealthHistoryFromActivities,
  readObjectiveHealthHistory,
} from "@/lib/objective-health-history";

describe("objective-health-history", () => {
  test("stores and reads objective health samples in chronological order", () => {
    let metadata: Record<string, unknown> = {};

    metadata = appendObjectiveHealthSample(metadata, {
      objectiveId: "objective-1",
      objectiveKey: "get-100-visitors-daily",
      progress: 5,
      status: "on_track",
      recordedAt: "2026-04-14T03:00:21.579Z",
      source: "scheduled-task:job-1",
    });
    metadata = appendObjectiveHealthSample(metadata, {
      objectiveId: "objective-1",
      objectiveKey: "get-100-visitors-daily",
      progress: 15,
      status: "on_track",
      recordedAt: "2026-04-14T06:35:13.400Z",
      source: "scheduled-task:job-1",
    });

    expect(readObjectiveHealthHistory(metadata, "objective-1")).toEqual([
      expect.objectContaining({
        progress: 5,
        status: "on_track",
        recordedAt: "2026-04-14T03:00:21.579Z",
      }),
      expect.objectContaining({
        progress: 15,
        status: "on_track",
        recordedAt: "2026-04-14T06:35:13.400Z",
      }),
    ]);
  });

  test("dedupes duplicate status-update activities while keeping later history points", () => {
    const history = buildObjectiveHealthHistoryFromActivities(
      [
        {
          id: "activity-1",
          source: "scheduled-task:e84da7c8",
          objectiveLabel: "get-100-visitors-daily",
          createdAt: "2026-04-14T03:00:21.579Z",
          type: "status-update",
          body: "**Objective worker** — success\n\nStarted work on ESO-535\n\nObjective health: 5% On track",
        },
        {
          id: "activity-2",
          source: "scheduled-task:e84da7c8",
          objectiveLabel: "get-100-visitors-daily",
          createdAt: "2026-04-14T03:00:21.580Z",
          type: "status-update",
          body: "**Objective worker** — success\n\nStarted work on ESO-535\n\nObjective health: 5% On track",
        },
        {
          id: "activity-3",
          source: "scheduled-task:e84da7c8",
          objectiveLabel: "get-100-visitors-daily",
          createdAt: "2026-04-14T06:35:13.400Z",
          type: "status-update",
          body: "**Objective worker** — success\n\nNo action taken\n\nObjective health: 15% On track",
        },
      ],
      "get-100-visitors-daily",
    );

    expect(history).toEqual([
      expect.objectContaining({
        progress: 5,
        status: "on_track",
        recordedAt: "2026-04-14T03:00:21.579Z",
      }),
      expect.objectContaining({
        progress: 15,
        status: "on_track",
        recordedAt: "2026-04-14T06:35:13.400Z",
      }),
    ]);
  });
});

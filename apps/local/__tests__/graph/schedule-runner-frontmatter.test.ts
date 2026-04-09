/**
 * @jest-environment node
 */

import type { GraphSchedule } from "@/src/graph/types";

const mockListVisibleAutomations = jest.fn();
const mockAutomationRecordToGraphSchedule = jest.fn();
const mockDbAll = jest.fn();

jest.mock("@/src/automations", () => ({
  automationRecordToGraphSchedule: (...args: unknown[]) => mockAutomationRecordToGraphSchedule(...args),
  getAutomationRepository: () => ({
    listVisibleAutomations: (...args: unknown[]) => mockListVisibleAutomations(...args),
  }),
  isAutomationDualReadEnabled: () => false,
  isAutomationFrontmatterEnabled: () => true,
}));

jest.mock("@/lib/sqlite-query-adapter", () => ({
  getSQLiteDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockDbAll(...args),
    }),
  }),
}));

jest.mock("@/src/graph/store", () => ({
  GraphStore: class GraphStore {},
}));

describe("getGraphsWithActiveSchedules", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("resolves taskId from the graph row when frontmatter omits target.taskId", async () => {
    const schedule: GraphSchedule = {
      intervalMs: 60_000,
      state: "active",
      resetNodeIds: ["run"],
      runCount: 0,
      tickInProgress: false,
      createdAt: "2026-04-07T18:00:00.000Z",
    };

    mockListVisibleAutomations.mockReturnValue([
      {
        definition: {
          id: "graph-1",
          name: "Inbox monitor",
          state: "active",
          trigger: {
            type: "scheduled",
            cronExpr: "*/1 * * * *",
          },
          target: {
            type: "execution_graph",
            graphId: "graph-1",
          },
        },
        runtimeState: {
          scheduleHash: "hash",
          updatedAt: "2026-04-07T18:00:00.000Z",
        },
        filePath: "/tmp/graph-1.md",
        archived: false,
      },
    ]);
    mockAutomationRecordToGraphSchedule.mockReturnValue(schedule);
    mockDbAll.mockReturnValue([
      {
        id: "graph-1",
        task_id: "task-1",
        schedule: JSON.stringify(schedule),
      },
    ]);

    const { getGraphsWithActiveSchedules } = await import("@/src/graph/schedule-runner");

    expect(getGraphsWithActiveSchedules()).toEqual([
      {
        graphId: "graph-1",
        taskId: "task-1",
        schedule,
      },
    ]);
  });
});

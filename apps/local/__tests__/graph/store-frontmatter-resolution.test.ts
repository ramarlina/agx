/**
 * @jest-environment node
 */

const mockListVisibleAutomations = jest.fn();
const mockSqlGet = jest.fn();

jest.mock("@/src/automations", () => ({
  automationRecordToGraphSchedule: jest.fn(),
  getAutomationRepository: () => ({
    getAutomation: jest.fn(),
    listVisibleAutomations: (...args: unknown[]) => mockListVisibleAutomations(...args),
    upsertAutomation: jest.fn(),
    updateAutomationState: jest.fn(),
  }),
  graphAutomationToDefinition: jest.fn(),
  isAutomationDualReadEnabled: () => false,
  isAutomationFrontmatterEnabled: () => true,
}));

jest.mock("@/lib/sqlite-query-adapter", () => ({
  getSQLiteDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => mockSqlGet(sql, ...args),
    }),
  }),
}));

describe("graph store frontmatter resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("resolves taskId by graphId for root-message lookups when target.taskId is omitted", async () => {
    mockListVisibleAutomations.mockReturnValue([
      {
        definition: {
          id: "graph-1",
          target: {
            type: "execution_graph",
            graphId: "graph-1",
            rootMessageId: "root-1",
          },
        },
      },
    ]);

    mockSqlGet.mockImplementation((sql: string) => {
      if (sql.includes("SELECT task_id AS taskId")) {
        return { taskId: "task-1" };
      }
      return undefined;
    });

    const { getActiveScheduleForRootMessageId } = await import("@/src/graph/store");

    expect(getActiveScheduleForRootMessageId("root-1")).toEqual({
      graphId: "graph-1",
      taskId: "task-1",
    });
  });
});

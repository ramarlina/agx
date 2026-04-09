/**
 * @jest-environment node
 */

const mockOrder = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();
const mockCreateAdminDbClient = jest.fn();

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: (...args: unknown[]) => mockCreateAdminDbClient(...args),
}));

describe("getProjectThreads", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockOrder.mockResolvedValue({ data: [], error: null });
    mockEq.mockReturnValue({ order: mockOrder });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockCreateAdminDbClient.mockReturnValue({ from: mockFrom });
  });

  test("orders project threads by oldest link first", async () => {
    const { getProjectThreads } = await import("@/lib/db");

    await getProjectThreads("project-1");

    expect(mockFrom).toHaveBeenCalledWith("project_threads");
    expect(mockSelect).toHaveBeenCalledWith("*");
    expect(mockEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: true });
  });
});

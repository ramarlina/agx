/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockFrom = jest.fn();

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: () => ({
    from: mockFrom,
  }),
}));

describe("/api/tasks/[id]/heartbeat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns ok for temporal task and updates orchestration timestamp", async () => {
    const selectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "task-1", status: "in_progress" },
        error: null,
      }),
    };
    const updateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    mockFrom.mockReturnValueOnce(selectQuery).mockReturnValueOnce(updateQuery);

    const { POST } = await import("@/app/api/tasks/[id]/heartbeat/route");
    const response = await POST(new NextRequest("http://localhost/api/tasks/task-1/heartbeat", { method: "POST" }), {
      params: Promise.resolve({ id: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(updateQuery.update).toHaveBeenCalled();
  });

  test("returns 404 when task does not exist", async () => {
    const selectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    mockFrom.mockReturnValueOnce(selectQuery);

    const { POST } = await import("@/app/api/tasks/[id]/heartbeat/route");
    const response = await POST(new NextRequest("http://localhost/api/tasks/task-1/heartbeat", { method: "POST" }), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(404);
  });
});

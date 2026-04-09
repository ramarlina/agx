/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetTask = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/db-instance", () => ({
  db: {
    getTask: mockGetTask,
  },
}));

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: () => ({
    from: mockFrom,
  }),
}));

describe("/api/tasks/[id]/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 404 when task is missing", async () => {
    mockGetTask.mockResolvedValueOnce(null);
    const { DELETE } = await import("@/app/api/tasks/[id]/history/route");
    const request = new NextRequest("http://localhost/api/tasks/task-1/history", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(404);
  });

  test("clears comments and logs", async () => {
    mockGetTask.mockResolvedValueOnce({ id: "task-1", user_id: "user-1" });
    const commentsQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: "c1" }, { id: "c2" }], error: null }),
    };
    const logsQuery = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: "l1" }], error: null }),
    };
    mockFrom.mockImplementation((table) => {
      if (table === "task_comments") return commentsQuery;
      if (table === "task_logs") return logsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const { DELETE } = await import("@/app/api/tasks/[id]/history/route");
    const request = new NextRequest("http://localhost/api/tasks/task-1/history", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "task-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.deleted.comments).toBe(2);
    expect(data.deleted.logs).toBe(1);
  });

  test("clears only comments when target=comments", async () => {
    mockGetTask.mockResolvedValueOnce({ id: "task-1", user_id: "user-1" });
    const commentsQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: "c1" }], error: null }),
    };
    mockFrom.mockImplementation((table) => {
      if (table === "task_comments") return commentsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const { DELETE } = await import("@/app/api/tasks/[id]/history/route");
    const request = new NextRequest("http://localhost/api/tasks/task-1/history?target=comments", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "task-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.target).toBe("comments");
    expect(data.deleted.comments).toBe(1);
    expect(data.deleted.logs).toBe(0);
  });

  test("returns 400 for invalid target", async () => {
    mockGetTask.mockResolvedValueOnce({ id: "task-1", user_id: "user-1" });
    const { DELETE } = await import("@/app/api/tasks/[id]/history/route");
    const request = new NextRequest("http://localhost/api/tasks/task-1/history?target=nope", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(400);
  });
});
